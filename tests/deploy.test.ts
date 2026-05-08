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
