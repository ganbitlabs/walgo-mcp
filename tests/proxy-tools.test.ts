import { afterEach, describe, expect, it } from "vitest";
import { startMcpServer } from "../src/server.js";
import { connectFakeBrowser } from "./helpers/fake-browser.js";
import { callJsonTool } from "./helpers/setup.js";
import type { RequestKind } from "../src/protocol.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

const cases: Array<{ tool: string; kind: RequestKind; args: Record<string, unknown> }> = [
  { tool: "walgo_list_files", kind: "list_files", args: {} },
  { tool: "walgo_delete_file", kind: "delete_file", args: { path: "/x.html" } },
  { tool: "walgo_init_template", kind: "init_template", args: { template: "blank" } },
  { tool: "walgo_clear_draft", kind: "clear_draft", args: {} },
  { tool: "walgo_load_site", kind: "load_site", args: { siteObjectId: "0xabc", network: "mainnet" } },
  { tool: "walgo_list_sites", kind: "list_sites", args: { network: "mainnet" } },
  { tool: "walgo_list_suins", kind: "list_suins", args: {} },
  { tool: "walgo_resolve_suins", kind: "resolve_suins", args: { name: "selim.sui" } },
  { tool: "walgo_epoch_info", kind: "epoch_info", args: {} },
  { tool: "walgo_extend_epochs", kind: "extend_epochs", args: { siteObjectId: "0xabc", epochs: 5 } },
  { tool: "walgo_link_suins", kind: "link_suins", args: { siteObjectId: "0xabc", suinsName: "foo" } },
];

describe("proxy tools", () => {
  it.each(cases)("$tool forwards to $kind with given params and returns the browser's data", async ({ tool, kind, args }) => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    let receivedKind: RequestKind | null = null;
    let receivedParams: unknown = null;
    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        [kind]: (params) => {
          receivedKind = kind;
          receivedParams = params;
          return { echo: kind };
        },
      },
    });
    cleanup.push(() => browser.close());

    const result = await callJsonTool<{ echo: string }>(client, tool, args);
    expect(result).toEqual({ echo: kind });
    expect(receivedKind).toBe(kind);
    expect(receivedParams).toMatchObject(args);
  });
});
