import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { Session } from "./session.js";
import {
  BridgeError,
  type BridgeRequest,
  type BrowserMessage,
  type RequestKind,
  type ServerMessage,
} from "./protocol.js";

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

export interface Bridge {
  port: number;
  url: string;
  request<T = unknown>(kind: RequestKind, params: unknown): Promise<T>;
  close(): Promise<void>;
}

export function startBridge(session: Session, port: number): Promise<Bridge> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    let pairedWs: WebSocket | null = null;
    const pending = new Map<string, Pending>();

    wss.once("error", reject);

    wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (raw) => {
        let msg: BrowserMessage;
        try {
          msg = JSON.parse(String(raw)) as BrowserMessage;
        } catch {
          return;
        }
        if (msg.type === "pair") {
          if (session.tryPair(msg.code, msg.address, msg.network)) {
            pairedWs = ws;
            sendToWs(ws, { type: "paired" });
          } else {
            sendToWs(ws, { type: "pair_failed", reason: "invalid_code" });
          }
          return;
        }
        if (msg.type === "response") {
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          if (msg.ok) p.resolve(msg.data);
          else p.reject(new BridgeError(msg.error.code, msg.error.message));
        }
      });

      ws.on("close", () => {
        if (ws !== pairedWs) return;
        pairedWs = null;
        for (const p of pending.values()) {
          p.reject(new BridgeError("disconnected", "Browser tab disconnected"));
        }
        pending.clear();
      });
    });

    wss.once("listening", () => {
      const addr = wss.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const bridge: Bridge = {
        port: actualPort,
        url: `ws://127.0.0.1:${actualPort}`,
        request<T>(kind: RequestKind, params: unknown): Promise<T> {
          if (!pairedWs || pairedWs.readyState !== pairedWs.OPEN) {
            return Promise.reject(new BridgeError("not_paired", "Browser not connected"));
          }
          const id = randomUUID();
          const req: BridgeRequest = { type: "request", id, kind, params };
          return new Promise<T>((res, rej) => {
            pending.set(id, {
              resolve: (data) => res(data as T),
              reject: rej,
            });
            pairedWs!.send(JSON.stringify(req));
          });
        },
        close: () =>
          new Promise<void>((res) => {
            for (const p of pending.values()) p.reject(new BridgeError("disconnected", "Bridge closed"));
            pending.clear();
            for (const client of wss.clients) client.terminate();
            wss.close(() => res());
          }),
      };
      resolve(bridge);
    });
  });
}

function sendToWs(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}
