// examples/smoke.mjs
//
// Drives walgo-mcp via stdio + simulates a browser via WebSocket.
// Runs a full round-trip without needing a wallet:
//
//   pair → fake browser pairs → walgo_status → walgo_init_template
//   → walgo_list_files → walgo_read_file
//
// Useful as a first-time smoke test after `npm run build`, and as a
// reference for what the wire protocol looks like in practice.
//
// Run:
//   npm run build
//   node examples/smoke.mjs

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { WebSocket } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(here, "..", "dist", "index.js");
const PORT = 49901; // unlikely to collide

console.log("→ spawning walgo-mcp (stdio) on WS port", PORT);

const transport = new StdioClientTransport({
  command: "node",
  args: [BIN],
  env: { ...process.env, WALGO_MCP_PORT: String(PORT) },
});
const client = new Client({ name: "walgo-smoke", version: "0" });
await client.connect(transport);

await waitForWs(`ws://127.0.0.1:${PORT}`);

// 1. Agent: walgo_pair
console.log("→ walgo_pair");
const pair = parseJson(await client.callTool({ name: "walgo_pair", arguments: {} }));
console.log("  code:", pair.code);

// 2. Fake browser: connect + send pair message
console.log("→ fake browser pairing");
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
await once(ws, "open");

const draft = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.type !== "request") return;
  const params = msg.params;
  let response;
  try {
    if (msg.kind === "init_template") {
      const name = params.siteName ?? "smoke";
      draft.clear();
      draft.set("/index.html", `<!doctype html><h1>${name}</h1>`);
      draft.set("/style.css", "body { font-family: sans-serif; }");
      response = { type: "response", id: msg.id, ok: true, data: { template: params.template, fileCount: draft.size, paths: [...draft.keys()] } };
    } else if (msg.kind === "list_files") {
      const files = [...draft.entries()].map(([path, content]) => ({ path, size: content.length, type: "text" }));
      response = { type: "response", id: msg.id, ok: true, data: { files } };
    } else if (msg.kind === "read_file") {
      const content = draft.get(params.path);
      if (content == null) {
        response = { type: "response", id: msg.id, ok: false, error: { code: "not_found", message: `${params.path} not in draft` } };
      } else {
        response = { type: "response", id: msg.id, ok: true, data: { path: params.path, content } };
      }
    } else {
      response = { type: "response", id: msg.id, ok: false, error: { code: "unhandled", message: msg.kind } };
    }
  } catch (err) {
    response = { type: "response", id: msg.id, ok: false, error: { code: "error", message: String(err) } };
  }
  ws.send(JSON.stringify(response));
});

const acked = waitForServerMessage(ws, (m) => m.type === "paired" || m.type === "pair_failed");
ws.send(JSON.stringify({ type: "pair", code: pair.code, address: "0xsmoke", network: "mainnet" }));
const ack = await acked;
if (ack.type !== "paired") throw new Error(`pair failed: ${ack.reason}`);
console.log("  paired ✓");

// 3. Agent: walgo_status
console.log("→ walgo_status");
const status = parseJson(await client.callTool({ name: "walgo_status", arguments: {} }));
console.log(" ", status);

// 4. Agent: walgo_init_template
console.log("→ walgo_init_template { template: 'blank', siteName: 'smoke' }");
const init = parseJson(await client.callTool({
  name: "walgo_init_template",
  arguments: { template: "blank", siteName: "smoke" },
}));
console.log(" ", init);

// 5. Agent: walgo_list_files
console.log("→ walgo_list_files");
const list = parseJson(await client.callTool({ name: "walgo_list_files", arguments: {} }));
console.log(" ", list);

// 6. Agent: walgo_read_file
console.log("→ walgo_read_file { path: '/index.html' }");
const read = parseJson(await client.callTool({ name: "walgo_read_file", arguments: { path: "/index.html" } }));
console.log(" ", read);

console.log("\nall good ✓");
ws.close();
await client.close();
await transport.close();
process.exit(0);

// ---- helpers -------------------------------------------------------------

function parseJson(result) {
  const text = result.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("tool returned no text content");
  return JSON.parse(text);
}

function once(target, event) {
  return new Promise((resolve, reject) => {
    target.once(event, resolve);
    target.once("error", reject);
  });
}

function waitForServerMessage(ws, predicate) {
  return new Promise((resolve) => {
    const handler = (raw) => {
      const msg = JSON.parse(String(raw));
      if (predicate(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function waitForWs(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise((res, rej) => {
        const probe = new WebSocket(url);
        probe.once("open", () => { probe.close(); res(); });
        probe.once("error", rej);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`bridge didn't open in ${timeoutMs}ms`);
}
