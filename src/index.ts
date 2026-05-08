#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Session } from "./session.js";
import { startBridge } from "./bridge.js";
import { registerWalgoTools } from "./tools.js";

const DEFAULT_PORT = Number(process.env.WALGO_MCP_PORT ?? 47823);

async function main(): Promise<void> {
  const session = new Session();
  const bridge = await startBridge(session, DEFAULT_PORT);

  const mcp = new McpServer({ name: "walgo-mcp", version: "0.0.1" });
  registerWalgoTools(mcp, bridge, session);

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  process.stderr.write(`walgo-mcp: WebSocket bridge on ${bridge.url}\n`);

  const shutdown = async () => {
    await bridge.close();
    await mcp.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  process.stderr.write(`walgo-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
