import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startMcpServer } from "../src/server.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.shift();
    if (fn) await fn().catch(() => {});
  }
});

describe("pairing edge cases", () => {
  it("wrong pair code → server sends pair_failed and stays unpaired", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    // Mint a code so the server has *something* to compare against,
    // then try to pair with a different code.
    const client = await mcp.testClient();
    cleanup.push(() => client.close());
    await client.callTool({ name: "walgo_pair", arguments: {} });

    const ws = new WebSocket(mcp.wsUrl);
    cleanup.push(
      () =>
        new Promise<void>((res) => {
          if (ws.readyState === ws.CLOSED) return res();
          ws.once("close", () => res());
          ws.close();
        }),
    );
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    const responsePromise = new Promise<{ type: string; reason?: string }>((resolve) => {
      ws.once("message", (raw) => {
        resolve(JSON.parse(String(raw)));
      });
    });

    ws.send(JSON.stringify({ type: "pair", code: "000000", address: "0xabc", network: "mainnet" }));

    const response = await responsePromise;
    expect(response.type).toBe("pair_failed");
    expect(response.reason).toBe("invalid_code");

    // walgo_status still reports unpaired
    const statusResult = await client.callTool({ name: "walgo_status", arguments: {} });
    const text = (statusResult.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")?.text;
    expect(text && JSON.parse(text)).toEqual({ paired: false });
  });

  it("pair attempt with no prior walgo_pair call → pair_failed", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const ws = new WebSocket(mcp.wsUrl);
    cleanup.push(
      () =>
        new Promise<void>((res) => {
          if (ws.readyState === ws.CLOSED) return res();
          ws.once("close", () => res());
          ws.close();
        }),
    );
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    const responsePromise = new Promise<{ type: string }>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(String(raw))));
    });
    ws.send(JSON.stringify({ type: "pair", code: "123456", address: "0xabc", network: "mainnet" }));

    const response = await responsePromise;
    expect(response.type).toBe("pair_failed");
  });

  it("malformed JSON from the browser is silently ignored (no crash)", async () => {
    const mcp = await startMcpServer({ wsPort: 0 });
    cleanup.push(() => mcp.close());

    const ws = new WebSocket(mcp.wsUrl);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });

    // Send garbage. Server should not respond, not crash, not close the WS.
    ws.send("not-json{{{");
    ws.send(Buffer.from([0xff, 0xfe, 0xfd]));

    // Give the server a tick to (not) process it.
    await new Promise((r) => setTimeout(r, 50));

    expect(ws.readyState).toBe(ws.OPEN);

    // Server is still functional — issue a code + pair successfully afterwards.
    const client = await mcp.testClient();
    cleanup.push(() => client.close());
    const pairResult = await client.callTool({ name: "walgo_pair", arguments: {} });
    const code = JSON.parse(
      (pairResult.content as Array<{ type: string; text: string }>).find((c) => c.type === "text")!.text,
    ).code as string;

    const ackPromise = new Promise<{ type: string }>((resolve) => {
      ws.once("message", (raw) => resolve(JSON.parse(String(raw))));
    });
    ws.send(JSON.stringify({ type: "pair", code, address: "0xabc", network: "mainnet" }));
    expect((await ackPromise).type).toBe("paired");

    cleanup.push(
      () =>
        new Promise<void>((res) => {
          if (ws.readyState === ws.CLOSED) return res();
          ws.once("close", () => res());
          ws.close();
        }),
    );
  });
});
