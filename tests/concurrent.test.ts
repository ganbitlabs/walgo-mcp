import { afterEach, describe, expect, it } from "vitest";
import { startMcpServer } from "../src/server.js";
import { connectFakeBrowser } from "./helpers/fake-browser.js";
import { callJsonTool } from "./helpers/setup.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("concurrent requests", () => {
  it("two in-flight reads return their own results regardless of completion order", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    let resolveSlow: ((data: { path: string; content: string }) => void) | null = null;
    const slowPromise = new Promise<{ path: string; content: string }>((r) => {
      resolveSlow = r;
    });

    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        read_file: async (params) => {
          const { path } = params as { path: string };
          if (path === "/slow") return slowPromise;
          return { path, content: `c-${path}` };
        },
      },
    });
    cleanup.push(() => browser.close());

    // Fire slow first (it will hang until we resolve it).
    const slowPending = callJsonTool(client, "walgo_read_file", { path: "/slow" });
    // Fire fast — should complete out-of-order before slow.
    const fast = await callJsonTool(client, "walgo_read_file", { path: "/fast" });
    expect(fast).toEqual({ path: "/fast", content: "c-/fast" });

    resolveSlow!({ path: "/slow", content: "c-/slow" });
    const slow = await slowPending;
    expect(slow).toEqual({ path: "/slow", content: "c-/slow" });
  });
});
