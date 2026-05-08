import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { startMcpServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("unpaired guard", () => {
  it("walgo_read_file before pairing returns a not_paired error", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const result = await client.callTool({
      name: "walgo_read_file",
      arguments: { path: "/index.html" },
    });

    expect(result.isError).toBe(true);
    const body = parseFirstText(result);
    expect(body).toEqual({ error: { code: "not_paired", message: expect.any(String) } });
  });
});

function parseFirstText(result: unknown): unknown {
  const r = result as { content?: Array<{ type: string; text: string }> };
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("no text content");
  return JSON.parse(text);
}
