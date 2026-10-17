import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  BridgeError,
  HEADERS_DESCRIPTION,
  type BridgeRequest,
  type BridgeResponse,
  type BrowserMessage,
  type Network,
  type RequestKind,
  type ServerMessage,
} from "./protocol.js";

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  SESSIONS: DurableObjectNamespace<SessionDO>;
  COORDINATOR: DurableObjectNamespace;
  MINT_RATE_LIMITER: RateLimit;
  WALGO_WEB_URL?: string;
}

class MintRateLimitError extends Error {
  constructor() {
    super("rate_limited");
  }
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

const PAIR_CODE_TTL_MS = 5 * 60 * 1000;
const SESSION_ID_HEADER = "x-walgo-session-id";
const DEFAULT_WALGO_WEB_URL = "https://web.walgo.xyz";

type Status = { paired: false } | { paired: true; address: string; network: Network };

/**
 * Per-MCP-session DO. Hosts an MCP server (Streamable HTTP via WorkerTransport)
 * and a WebSocket connection from the user's paired browser tab. Tool calls
 * that need wallet/wal.app access are forwarded to the browser over the WS,
 * with id-based request/response correlation.
 *
 *   POST /mcp     → MCP request (agent side, via Streamable HTTP)
 *   GET  /pair    → WS upgrade (browser side, after Coordinator validated the code)
 */
export class SessionDO extends DurableObject<Env> {
  private mcpHandler: ((req: Request) => Promise<Response>) | null = null;
  private pairedWs: WebSocket | null = null;
  private status: Status = { paired: false };
  private pending = new Map<string, Pending>();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/mcp") {
      await this.ensureMcp(request);
      return this.mcpHandler!(request);
    }

    if (url.pathname === "/pair") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      return this.handlePairUpgrade();
    }

    return new Response("not found", { status: 404 });
  }

  // ---- MCP -----------------------------------------------------------------

  private async ensureMcp(request: Request): Promise<void> {
    if (this.mcpHandler) return;

    // Lazy import: keep the SDK out of the cold path of pair-only DOs.
    const { createMcpHandler, WorkerTransport } = await import("agents/mcp");

    const server = new McpServer({ name: "walgo-mcp", version: "0.0.1" });
    this.registerTools(server);

    const sessionId = request.headers.get(SESSION_ID_HEADER) ?? crypto.randomUUID();

    const transport = new WorkerTransport({
      sessionIdGenerator: () => sessionId,
      storage: {
        get: () => this.ctx.storage.get<unknown>("mcp-transport-state") as never,
        set: (state: unknown) => {
          this.ctx.storage.put("mcp-transport-state", state);
        },
      },
    });

    const handler = createMcpHandler(server, { transport });
    this.mcpHandler = (req: Request) =>
      handler(req, this.env as unknown as Record<string, unknown>, this.ctx as unknown as ExecutionContext);
  }

  private registerTools(server: McpServer): void {
    server.registerTool(
      "walgo_pair",
      { description: "Issue a one-shot pairing code and a deep link the user can open to pair their walgo browser tab." },
      async () => {
        try {
          const code = await this.requestPairing();
          const baseWeb = this.env.WALGO_WEB_URL ?? DEFAULT_WALGO_WEB_URL;
          return ok({ code, deepLink: `${baseWeb}/pair/${code}`, expiresInSeconds: PAIR_CODE_TTL_MS / 1000 });
        } catch (err) {
          if (err instanceof MintRateLimitError) {
            return errorResult(
              "rate_limited",
              "walgo_pair mint rate exceeded for this session — wait ~60 seconds before retrying.",
            );
          }
          throw err;
        }
      },
    );

    server.registerTool(
      "walgo_status",
      { description: "Report current pairing status and connected wallet info." },
      async () => ok(this.status),
    );

    const text = z.string();
    const network = z.enum(["mainnet", "testnet"]);
    const positive = z.number().int().positive();

    this.registerProxy(server, "walgo_write_file", "write_file", {
      description: "Write a file to the in-browser draft. Provide exactly one of `content` (utf-8 text) or `contentBase64` (binary).",
      inputSchema: { path: text, content: text.optional(), contentBase64: text.optional() },
    });
    this.registerProxy(server, "walgo_read_file", "read_file", {
      description: "Read a file from the in-browser draft.",
      inputSchema: { path: text },
    });
    this.registerProxy(server, "walgo_list_files", "list_files", {
      description: "List file paths in the in-browser draft.",
      inputSchema: {},
    });
    this.registerProxy(server, "walgo_delete_file", "delete_file", {
      description: "Delete a file from the in-browser draft.",
      inputSchema: { path: text },
    });
    this.registerProxy(server, "walgo_init_template", "init_template", {
      description: "Scaffold a new draft from a built-in template (replaces current draft).",
      inputSchema: { template: z.enum(["portfolio", "bio", "landing", "blank"]), siteName: text.optional() },
    });
    this.registerProxy(server, "walgo_clear_draft", "clear_draft", {
      description: "Empty the in-browser draft.",
      inputSchema: {},
    });
    this.registerProxy(server, "walgo_load_site", "load_site", {
      description: "Load a deployed site's resources into the in-browser draft for editing (replaces current draft). Returns the file paths and the site's current custom headers.",
      inputSchema: { siteObjectId: text, network },
    });
    this.registerProxy(server, "walgo_deploy", "deploy", {
      description: "Deploy the current in-browser draft to Walrus + Sui. The browser tab signs all transactions with the user's wallet.",
      inputSchema: {
        network,
        epochs: positive,
        siteName: text.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        routes: z.record(z.string(), text).optional(),
        headers: z.record(text, z.record(text, text)).describe(HEADERS_DESCRIPTION).optional(),
        existingSiteObjectId: text.optional(),
      },
    });
    this.registerProxy(server, "walgo_list_sites", "list_sites", {
      description: "List sites owned by the connected wallet on the given network.",
      inputSchema: { network },
    });
    this.registerProxy(server, "walgo_list_suins", "list_suins", {
      description: "List SuiNS names owned by the connected wallet, with the site object id each currently points to.",
      inputSchema: {},
    });
    this.registerProxy(server, "walgo_resolve_suins", "resolve_suins", {
      description: "Look up which site object a SuiNS name currently points to (returns null if unset).",
      inputSchema: { name: text, network: network.optional() },
    });
    this.registerProxy(server, "walgo_epoch_info", "epoch_info", {
      description: "Get the current Walrus epoch number and epoch duration in milliseconds.",
      inputSchema: {},
    });
    this.registerProxy(server, "walgo_extend_epochs", "extend_epochs", {
      description: "Extend Walrus blob storage duration for an existing site.",
      inputSchema: { siteObjectId: text, epochs: positive },
    });
    this.registerProxy(server, "walgo_link_suins", "link_suins", {
      description: "Link a SuiNS name to a deployed site so it serves at <name>.wal.app.",
      inputSchema: { siteObjectId: text, suinsName: text },
    });
  }

  private registerProxy(
    server: McpServer,
    name: string,
    kind: RequestKind,
    config: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
  ): void {
    server.registerTool(name, config, async (args) => {
      if (!this.status.paired) {
        return errorResult("not_paired", "Pair the agent with a walgo browser tab first (call walgo_pair).");
      }
      try {
        const data = await this.bridgeRequest(kind, args);
        return ok(data);
      } catch (err) {
        if (err instanceof BridgeError) return errorResult(err.code, err.message);
        return errorResult("internal", err instanceof Error ? err.message : String(err));
      }
    });
  }

  // ---- Pairing -------------------------------------------------------------

  private async requestPairing(): Promise<string> {
    // Per-session mint cap (binding configured in wrangler.jsonc). Stops a
    // single agent from flooding the Coordinator with one-shot codes.
    const { success } = await this.env.MINT_RATE_LIMITER.limit({ key: this.ctx.id.toString() });
    if (!success) throw new MintRateLimitError();

    const code = generatePairingCode();
    const coordId = this.env.COORDINATOR.idFromName("singleton");
    const coord = this.env.COORDINATOR.get(coordId);
    await coord.fetch("https://coord.internal/register", {
      method: "POST",
      body: JSON.stringify({ code, sessionDoId: this.ctx.id.toString(), ttlMs: PAIR_CODE_TTL_MS }),
    });
    return code;
  }

  // ---- Bridge --------------------------------------------------------------

  private bridgeRequest<T = unknown>(kind: RequestKind, params: unknown): Promise<T> {
    if (!this.pairedWs || this.pairedWs.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BridgeError("not_paired", "Browser not connected"));
    }
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (data) => resolve(data as T), reject });
      const req: BridgeRequest = { type: "request", id, kind, params };
      this.pairedWs!.send(JSON.stringify(req));
    });
  }

  private handlePairUpgrade(): Response {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    server.addEventListener("message", (ev) => {
      this.onBrowserMessage(server, ev as MessageEvent);
    });
    server.addEventListener("close", () => {
      this.onBrowserClose(server);
    });
    server.addEventListener("error", () => {
      this.onBrowserClose(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private onBrowserMessage(ws: WebSocket, ev: MessageEvent): void {
    let msg: BrowserMessage;
    try {
      msg = JSON.parse(String(ev.data)) as BrowserMessage;
    } catch {
      return;
    }
    if (msg.type === "pair") {
      // The Worker already validated the pairing code via the Coordinator
      // before forwarding this WS to us; trust the address+network the
      // browser sends and record state.
      this.pairedWs = ws;
      this.status = { paired: true, address: msg.address, network: msg.network };
      sendServerMessage(ws, { type: "paired" });
      return;
    }
    if (msg.type === "response") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.data);
      else pending.reject(new BridgeError(msg.error.code, msg.error.message));
    }
  }

  private onBrowserClose(ws: WebSocket): void {
    if (ws !== this.pairedWs) return;
    this.pairedWs = null;
    this.status = { paired: false };
    for (const p of this.pending.values()) {
      p.reject(new BridgeError("disconnected", "Browser tab disconnected"));
    }
    this.pending.clear();
  }
}

// ---- helpers ---------------------------------------------------------------

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

function sendServerMessage(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function generatePairingCode(): string {
  // 8-digit numeric — 100M space, easy for humans to type, fine when paired
  // with a 5-minute TTL + per-IP rate limit on the /pair endpoint.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0]! % 100_000_000).padStart(8, "0");
}

// Re-export for consumers that need to know which header the worker uses
export { SESSION_ID_HEADER };
// Suppress unused-locals warnings in case BridgeRequest re-export pulls in BridgeResponse.
export type { BridgeRequest, BridgeResponse };
