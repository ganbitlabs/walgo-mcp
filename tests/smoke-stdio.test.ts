import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";
import type { BrowserMessage, ServerMessage } from "../src/protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "..", "dist", "index.js");

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("stdio + ws end-to-end smoke", () => {
  it("real binary: pair, write, read round-trip", async () => {
    if (!existsSync(BIN)) {
      throw new Error(`Build the package first (npx tsc). Missing: ${BIN}`);
    }

    const PORT = 49283;
    const WS_URL = `ws://127.0.0.1:${PORT}`;

    const transport = new StdioClientTransport({
      command: "node",
      args: [BIN],
      env: { ...process.env, WALGO_MCP_PORT: String(PORT) },
    });
    const client = new Client({ name: "smoke", version: "0" });
    await client.connect(transport);
    cleanup.push(async () => {
      await client.close();
      await transport.close();
    });

    await waitForWs(WS_URL);

    // 1. Agent gets pairing code via stdio
    const pairResult = await client.callTool({ name: "walgo_pair", arguments: {} });
    const pair = JSON.parse(firstText(pairResult)) as { code: string };
    expect(pair.code).toMatch(/^\d{6}$/);

    // 2. Fake browser pairs over the bridge ws
    const ws = new WebSocket(WS_URL);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    cleanup.push(async () => {
      ws.close();
    });

    const files = new Map<string, string>();
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type !== "request") return;
      const params = msg.params as { path?: string; content?: string };
      let response: BrowserMessage;
      if (msg.kind === "write_file" && params.path && typeof params.content === "string") {
        files.set(params.path, params.content);
        response = { type: "response", id: msg.id, ok: true, data: { written: true } };
      } else if (msg.kind === "read_file" && params.path) {
        const content = files.get(params.path);
        if (content === undefined) {
          response = { type: "response", id: msg.id, ok: false, error: { code: "not_found", message: "missing" } };
        } else {
          response = { type: "response", id: msg.id, ok: true, data: { path: params.path, content } };
        }
      } else {
        response = { type: "response", id: msg.id, ok: false, error: { code: "unhandled", message: msg.kind } };
      }
      ws.send(JSON.stringify(response));
    });

    const acked = waitForMessage(ws, (m) => m.type === "paired" || m.type === "pair_failed");
    ws.send(
      JSON.stringify({ type: "pair", code: pair.code, address: "0xabc", network: "mainnet" } satisfies BrowserMessage),
    );
    const ackMsg = await acked;
    expect(ackMsg.type).toBe("paired");

    // 3. Round-trip through the real binary
    await client.callTool({
      name: "walgo_write_file",
      arguments: { path: "/index.html", content: "<h1>Hello</h1>" },
    });
    const readResult = await client.callTool({
      name: "walgo_read_file",
      arguments: { path: "/index.html" },
    });
    const read = JSON.parse(firstText(readResult)) as { path: string; content: string };
    expect(read).toEqual({ path: "/index.html", content: "<h1>Hello</h1>" });
  });
});

function firstText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("no text content");
  return text;
}

function waitForMessage(ws: WebSocket, predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const handler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (predicate(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function waitForWs(url: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((res, rej) => {
        const probe = new WebSocket(url);
        probe.once("open", () => {
          probe.close();
          res();
        });
        probe.once("error", rej);
      });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`bridge did not open within ${timeoutMs}ms (${url}): ${lastErr}`);
}
