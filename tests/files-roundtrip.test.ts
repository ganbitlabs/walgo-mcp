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

describe("file round-trip", () => {
  it("walgo_write_file then walgo_read_file returns same content", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    const files = new Map<string, string>();
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        write_file: (params) => {
          const { path, content } = params as { path: string; content: string };
          files.set(path, content);
          return { written: true };
        },
        read_file: (params) => {
          const { path } = params as { path: string };
          const content = files.get(path);
          if (content == null) {
            throw { code: "not_found", message: `${path} not found` };
          }
          return { path, content };
        },
      },
    });
    cleanup.push(() => browser.close());

    await callJsonTool(client, "walgo_write_file", { path: "/index.html", content: "<h1>Hi</h1>" });
    const read = await callJsonTool(client, "walgo_read_file", { path: "/index.html" });

    expect(read).toEqual({ path: "/index.html", content: "<h1>Hi</h1>" });
  });
});
