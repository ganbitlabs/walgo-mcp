import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Session } from "./session.js";
import { startBridge } from "./bridge.js";
import { registerWalgoTools } from "./tools.js";

export interface StartOpts {
  wsPort?: number;
}

export interface RunningMcp {
  wsUrl: string;
  testClient(): Promise<Client>;
  close(): Promise<void>;
}

export async function startMcpServer(opts: StartOpts = {}): Promise<RunningMcp> {
  const session = new Session();
  const bridge = await startBridge(session, opts.wsPort ?? 0);

  const mcp = new McpServer({ name: "walgo-mcp", version: "0.0.1" });
  registerWalgoTools(mcp, bridge, session);

  return {
    wsUrl: bridge.url,
    async testClient(): Promise<Client> {
      const [serverT, clientT] = InMemoryTransport.createLinkedPair();
      await mcp.connect(serverT);
      const client = new Client({ name: "test", version: "0" });
      await client.connect(clientT);
      return client;
    },
    async close() {
      await bridge.close();
      await mcp.close();
    },
  };
}
