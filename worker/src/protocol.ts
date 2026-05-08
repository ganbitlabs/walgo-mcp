// Wire protocol shared with walgo-web's src/lib/mcp/protocol.ts.
// Keep in sync with ../../src/protocol.ts (Node stdio) and walgo-web/src/lib/mcp/protocol.ts.

export type Network = "mainnet" | "testnet";

export type RequestKind =
  | "write_file"
  | "read_file"
  | "list_files"
  | "delete_file"
  | "init_template"
  | "clear_draft"
  | "load_site"
  | "deploy"
  | "list_sites"
  | "list_suins"
  | "resolve_suins"
  | "epoch_info"
  | "extend_epochs"
  | "link_suins";

export interface BridgeRequest {
  type: "request";
  id: string;
  kind: RequestKind;
  params: unknown;
}

export interface BridgeResponseOk {
  type: "response";
  id: string;
  ok: true;
  data: unknown;
}

export interface BridgeResponseErr {
  type: "response";
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

export type BrowserMessage =
  | { type: "pair"; code: string; address: string; network: Network }
  | BridgeResponse;

export type ServerMessage =
  | { type: "paired" }
  | { type: "pair_failed"; reason: string }
  | BridgeRequest;

export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}
