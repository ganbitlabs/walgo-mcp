import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import type { BridgeRequest, DeployParams } from "../src/protocol";

interface RpcResult {
  result?: { isError?: boolean; content?: Array<{ text: string }> };
}

type Rpc = (id: number, method: string, params: unknown) => Promise<RpcResult>;

async function startAgent(sessionId: string): Promise<Rpc> {
  const rpc: Rpc = async (id, method, params) => {
    const res = await SELF.fetch("https://example.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const body = await res.text();
    const data = body.split("\n").find((line) => line.startsWith("data: "));
    return JSON.parse(data ? data.slice("data: ".length) : body) as RpcResult;
  };
  await rpc(1, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  return rpc;
}

async function pairBrowser(rpc: Rpc): Promise<WebSocket> {
  const pair = await rpc(2, "tools/call", { name: "walgo_pair", arguments: {} });
  const { code } = JSON.parse(pair.result!.content![0]!.text) as { code: string };

  const res = await SELF.fetch(`https://example.com/pair?code=${code}`, { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket!;
  ws.accept();
  const paired = new Promise<void>((resolve) => {
    ws.addEventListener("message", (ev) => {
      if ((JSON.parse(String(ev.data)) as { type: string }).type === "paired") resolve();
    }, { once: true });
  });
  ws.send(JSON.stringify({ type: "pair", code, address: "0xabc", network: "testnet" }));
  await paired;
  return ws;
}

describe("walgo_deploy custom headers", () => {
  it("forwards custom headers to the paired browser unchanged", async () => {
    const rpc = await startAgent("headers-forwarded");
    const ws = await pairBrowser(rpc);
    const received = new Promise<BridgeRequest>((resolve) => {
      ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(String(ev.data)) as BridgeRequest;
        if (msg.type !== "request") return;
        resolve(msg);
        ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, data: { objectId: "0xsite123" } }));
      });
    });

    const params: DeployParams = {
      network: "testnet",
      epochs: 2,
      headers: { "/index.html": { "Cache-Control": "no-cache" }, "/old.html": {} },
    };
    const call = await rpc(3, "tools/call", { name: "walgo_deploy", arguments: { ...params } });

    const request = await received;
    expect(request.kind).toBe("deploy");
    expect(request.params).toEqual(params);
    expect(call.result!.isError).toBeUndefined();
    expect(JSON.parse(call.result!.content![0]!.text)).toEqual({ objectId: "0xsite123" });
  });

  it("rejects a malformed headers table before it reaches the browser", async () => {
    const rpc = await startAgent("headers-rejected");
    const ws = await pairBrowser(rpc);
    let forwarded = 0;
    ws.addEventListener("message", (ev) => {
      if ((JSON.parse(String(ev.data)) as { type: string }).type === "request") forwarded++;
    });

    const call = await rpc(3, "tools/call", {
      name: "walgo_deploy",
      arguments: { network: "testnet", epochs: 2, headers: { "/index.html": { "Cache-Control": 5 } } },
    });

    expect(call.result!.isError).toBe(true);
    expect(forwarded).toBe(0);
  });
});
