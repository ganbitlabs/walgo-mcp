import { afterEach, describe, expect, it } from "vitest";
import { startMcpServer } from "../src/server.js";
import { connectFakeBrowser } from "./helpers/fake-browser.js";
import { callJsonTool, expectToolError } from "./helpers/setup.js";
import type { DeployParams } from "../src/protocol.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

async function pairedClient(deploy: (params: unknown) => unknown) {
  const mcp = await startMcpServer({ wsPort: 0 });
  cleanup.push(() => mcp.close());

  const client = await mcp.testClient();
  cleanup.push(() => client.close());

  const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");
  const browser = await connectFakeBrowser({
    url: mcp.wsUrl,
    pair: { code: pair.code, address: "0xabc", network: "testnet" },
    handlers: { deploy },
  });
  cleanup.push(() => browser.close());
  return client;
}

describe("deploy", () => {
  it("returns the site object id and digest the browser produced", async () => {
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
        deploy: (params) => {
          received = params;
          return {
            objectId: "0xsite123",
            siteUrl: "https://suiscan.xyz/mainnet/object/0xsite123",
            network: "mainnet",
            digest: "abcdef",
            noChanges: false,
            fileCount: 3,
            totalSize: 1024,
          };
        },
      },
    });
    cleanup.push(() => browser.close());

    const result = await callJsonTool<Record<string, unknown>>(client, "walgo_deploy", {
      network: "mainnet",
      epochs: 10,
      siteName: "my-site",
    });

    expect(result).toMatchObject({
      objectId: "0xsite123",
      digest: "abcdef",
      network: "mainnet",
      fileCount: 3,
    });
    expect(received).toMatchObject({ network: "mainnet", epochs: 10, siteName: "my-site" });
  });

  it("forwards custom headers to the browser unchanged", async () => {
    let received: unknown = null;
    const client = await pairedClient((params) => {
      received = params;
      return { objectId: "0xsite123" };
    });

    const params: DeployParams = {
      network: "testnet",
      epochs: 2,
      existingSiteObjectId: "0xsite123",
      headers: {
        "/index.html": { "Cache-Control": "no-cache", "X-Frame-Options": "DENY" },
        "/old.html": {},
      },
    };
    await callJsonTool(client, "walgo_deploy", { ...params });

    expect(received).toEqual(params);
  });

  it.each([
    ["a header value that is not a string", { "/index.html": { "Cache-Control": 5 } }],
    ["a path whose headers are not an object", { "/index.html": "no-cache" }],
    ["a headers table that is an array", [{ "Cache-Control": "no-cache" }]],
  ])("rejects %s before it reaches the browser", async (_label, headers) => {
    let calls = 0;
    const client = await pairedClient(() => {
      calls++;
      return { objectId: "0xsite123" };
    });

    const result = await client.callTool({
      name: "walgo_deploy",
      arguments: { network: "testnet", epochs: 2, headers },
    });

    expect(result.isError).toBe(true);
    expect(calls).toBe(0);
  });

  it("surfaces wallet rejection as a typed error", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const client = await mcp.testClient();
    cleanup.push(() => client.close());

    const pair = await callJsonTool<{ code: string }>(client, "walgo_pair");

    const browser = await connectFakeBrowser({
      url: mcp.wsUrl,
      pair: { code: pair.code, address: "0xabc", network: "mainnet" },
      handlers: {
        deploy: () => {
          throw { code: "wallet_rejected", message: "User rejected the transaction in their wallet" };
        },
      },
    });
    cleanup.push(() => browser.close());

    const result = await client.callTool({
      name: "walgo_deploy",
      arguments: { network: "mainnet", epochs: 10 },
    });

    const err = expectToolError(result);
    expect(err.code).toBe("wallet_rejected");
    expect(err.message).toMatch(/rejected/i);
  });
});
