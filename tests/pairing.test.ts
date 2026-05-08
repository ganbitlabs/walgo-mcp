import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { startMcpServer } from "../src/server.js";
import { connectFakeBrowser } from "./helpers/fake-browser.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("pairing handshake", () => {
  it("agent and browser pair, status reports paired with browser-supplied wallet info", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    // 1. Agent requests a pairing code
    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");
    expect(pair.code).toMatch(/^\d{6}$/);

    // 2. Browser tab supplies the code over WS
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
    });
    cleanup.push(() => browser.close());

    // 3. Status now reports paired
    const status = await callJsonTool<unknown>(client, "walgo_status");
    expect(status).toEqual({ paired: true, address: "0xabc", network: "mainnet" });
  });
});

async function callJsonTool<T>(client: Client, name: string): Promise<T> {
  const result = await client.callTool({ name, arguments: {} });
  const content = (result.content as Array<{ type: string; text: string }> | undefined) ?? [];
  const first = content.find((c) => c.type === "text");
  if (!first) throw new Error(`tool ${name} returned no text content`);
  return JSON.parse(first.text) as T;
}
