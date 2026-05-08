import { WebSocket } from "ws";
import type { BridgeResponse, Network, RequestKind, ServerMessage } from "../../src/protocol.js";

export type Handler = (params: unknown) => unknown | Promise<unknown>;

export interface FakeBrowserOpts {
  url: string;
  pair: { code: string; address: string; network: Network };
  handlers?: Partial<Record<RequestKind, Handler>>;
}

export interface FakeBrowser {
  close(): Promise<void>;
}

export async function connectFakeBrowser(opts: FakeBrowserOpts): Promise<FakeBrowser> {
  const ws = new WebSocket(opts.url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const ack = new Promise<void>((resolve, reject) => {
    const onPair = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      if (msg.type === "paired") {
        ws.off("message", onPair);
        resolve();
      } else if (msg.type === "pair_failed") {
        ws.off("message", onPair);
        reject(new Error(msg.reason));
      }
    };
    ws.on("message", onPair);
  });
  ws.send(JSON.stringify({ type: "pair", ...opts.pair }));
  await ack;

  ws.on("message", async (raw) => {
    const msg = JSON.parse(String(raw)) as ServerMessage;
    if (msg.type !== "request") return;
    const handler = opts.handlers?.[msg.kind];
    let response: BridgeResponse;
    if (!handler) {
      response = { type: "response", id: msg.id, ok: false, error: { code: "unhandled", message: `no handler for ${msg.kind}` } };
    } else {
      try {
        const data = await handler(msg.params);
        response = { type: "response", id: msg.id, ok: true, data };
      } catch (err) {
        const e = err as { code?: string; message?: string };
        response = {
          type: "response",
          id: msg.id,
          ok: false,
          error: { code: e.code ?? "error", message: e.message ?? "unknown" },
        };
      }
    }
    ws.send(JSON.stringify(response));
  });

  return {
    close: () =>
      new Promise<void>((res) => {
        if (ws.readyState === ws.CLOSED) return res();
        ws.once("close", () => res());
        ws.close();
      }),
  };
}
