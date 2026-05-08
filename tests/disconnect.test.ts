import { afterEach, describe, expect, it } from "vitest";
import { startMcpServer } from "../src/server.js";
import { connectFakeBrowser } from "./helpers/fake-browser.js";
import { callJsonTool, expectToolError } from "./helpers/setup.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("browser disconnect", () => {
  it("pending request rejects with disconnected error when browser closes mid-call", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    // A handler that never resolves — request will be pending until the browser closes.
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        read_file: () => new Promise(() => {}),
      },
    });

    const pending = client.callTool({
      name: "walgo_read_file",
      arguments: { path: "/x.html" },
    });

    // Wait a tick so the request reaches the browser before we close.
    await new Promise((r) => setTimeout(r, 30));
    await browser.close();

    const result = await pending;
    const err = expectToolError(result);
    expect(err.code).toBe("disconnected");
  });
});
