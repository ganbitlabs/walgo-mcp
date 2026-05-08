import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { BridgeError, type RequestKind } from "./protocol.js";
import { errorResult, ok } from "./result.js";
import type { Session } from "./session.js";
import type { Bridge } from "./bridge.js";

interface ProxyToolDef {
  name: string;
  kind: RequestKind;
  description: string;
  inputSchema: ZodRawShapeCompat;
}

const PROXY_TOOLS: ProxyToolDef[] = [
  { name: "walgo_write_file", kind: "write_file", description: "Write a file to the in-browser draft.", inputSchema: { path: z.string(), content: z.string() } },
  { name: "walgo_read_file", kind: "read_file", description: "Read a file from the in-browser draft.", inputSchema: { path: z.string() } },
  { name: "walgo_list_files", kind: "list_files", description: "List file paths in the in-browser draft.", inputSchema: {} },
  { name: "walgo_delete_file", kind: "delete_file", description: "Delete a file from the in-browser draft.", inputSchema: { path: z.string() } },
  { name: "walgo_init_template", kind: "init_template", description: "Scaffold a new draft from a built-in template (replaces current draft).", inputSchema: { template: z.enum(["portfolio", "bio", "landing", "blank"]), siteName: z.string().optional() } },
  { name: "walgo_deploy", kind: "deploy", description: "Deploy the current in-browser draft to Walrus + Sui. The browser tab signs all transactions with the user's wallet.", inputSchema: { network: z.enum(["mainnet", "testnet"]), epochs: z.number().int().positive(), siteName: z.string().optional(), metadata: z.record(z.unknown()).optional(), routes: z.record(z.string()).optional(), existingSiteObjectId: z.string().optional() } },
  { name: "walgo_list_sites", kind: "list_sites", description: "List sites owned by the connected wallet on the given network.", inputSchema: { network: z.enum(["mainnet", "testnet"]) } },
  { name: "walgo_extend_epochs", kind: "extend_epochs", description: "Extend Walrus blob storage duration for an existing site.", inputSchema: { siteObjectId: z.string(), epochs: z.number().int().positive() } },
  { name: "walgo_link_suins", kind: "link_suins", description: "Link a SuiNS name to a deployed site so it serves at <name>.wal.app.", inputSchema: { siteObjectId: z.string(), suinsName: z.string() } },
];

export function registerWalgoTools(mcp: McpServer, bridge: Bridge, session: Session): void {
  mcp.registerTool(
    "walgo_pair",
    { description: "Issue a pairing code to enter in the walgo browser tab." },
    async () => ok({ code: session.requestPairing() }),
  );

  mcp.registerTool(
    "walgo_status",
    { description: "Report current pairing status." },
    async () => ok(session.getStatus()),
  );

  for (const def of PROXY_TOOLS) {
    mcp.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
      async (args) => {
        if (!session.getStatus().paired) {
          return errorResult("not_paired", "Pair the agent with a walgo browser tab first (call walgo_pair).");
        }
        try {
          const data = await bridge.request(def.kind, args);
          return ok(data);
        } catch (err) {
          if (err instanceof BridgeError) return errorResult(err.code, err.message);
          const message = err instanceof Error ? err.message : String(err);
          return errorResult("internal", message);
        }
      },
    );
  }
}
