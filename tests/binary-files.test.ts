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

describe("binary file support", () => {
  it("walgo_write_file accepts contentBase64 and forwards it as a binary write", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    let received: unknown = null;
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        write_file: (params) => {
          received = params;
          return { written: true };
        },
      },
    });
    cleanup.push(() => browser.close());

    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    await callJsonTool(client, "walgo_write_file", { path: "/dot.png", contentBase64: png });
    expect(received).toEqual({ path: "/dot.png", contentBase64: png });
  });

  it("walgo_write_file still accepts plain text content", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    let received: unknown = null;
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        write_file: (params) => {
          received = params;
          return { written: true };
        },
      },
    });
    cleanup.push(() => browser.close());

    await callJsonTool(client, "walgo_write_file", { path: "/index.html", content: "<h1>Hi</h1>" });
    expect(received).toEqual({ path: "/index.html", content: "<h1>Hi</h1>" });
  });
});
