// @walgo/mcp-protocol
//
// Wire protocol between walgo-mcp (server) and the paired walgo browser tab.
// One source of truth, consumed by both the stdio binary (../../src) and the
// Cloudflare Worker (../../worker/src).
//
// walgo-web (separate, private repo) keeps its own copy of this protocol on
// the browser side; if you change anything here, mirror it there.

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

/**
 * Custom HTTP response headers per exact file path, the shape of the `headers`
 * table in a site's `ws-resources.json`:
 * `{ "/index.html": { "Cache-Control": "no-cache" } }`.
 */
export type HeaderTable = Record<string, Record<string, string>>;

export const HEADERS_DESCRIPTION = `Custom HTTP response headers per exact file path, e.g. {"/index.html": {"Cache-Control": "no-cache"}}. Replaces the headers of each file named; a file left out keeps its current headers. Map a path to {} to clear that file's headers. An empty table names no file and changes nothing.`;

export interface DeployParams {
  network: Network;
  epochs: number;
  siteName?: string;
  metadata?: Record<string, unknown>;
  routes?: Record<string, string>;
  /**
   * Replaces the headers of each file it names. A file it omits keeps the headers
   * it has on chain. A file mapped to `{}` has its headers cleared. An empty table
   * names no file and changes nothing.
   */
  headers?: HeaderTable;
  existingSiteObjectId?: string;
}

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

/**
 * Thrown by the bridge when a forwarded tool call fails (browser sent an error
 * response, or the bridge itself disconnected). The `code` is the typed error
 * string the agent will see (e.g. "wallet_rejected", "disconnected",
 * "not_paired").
 */
export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}
