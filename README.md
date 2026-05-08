# walgo-mcp

MCP server bridging an agent (Claude Code, Cursor, etc.) to a running [walgo](https://web.walgo.xyz) browser tab. The browser tab holds the user's wallet and signs all Sui/Walrus transactions; the MCP server is a typed proxy.

## Architecture

```
agent  ──stdio (MCP)──▶  walgo-mcp  ──ws://127.0.0.1──▶  walgo browser tab (wallet)
```

- The MCP server runs locally and listens on a localhost WebSocket (default `127.0.0.1:47823`).
- The user opens [web.walgo.xyz](https://web.walgo.xyz) (or `localhost:5173` in dev), goes to the "Connect MCP" panel, pastes the 6-digit code that `walgo_pair` returned.
- After pairing, all proxy tools (`walgo_deploy`, `walgo_read_file`, …) forward to the browser. The wallet signs.

## Install / run

```bash
npm install
npm run build
node dist/index.js          # or `npx walgo-mcp` after install
```

Configure your MCP host (Claude Code etc.) to launch `node /path/to/walgo-mcp/dist/index.js`.

## Tools

| Tool | Notes |
|------|-------|
| `walgo_pair` | Issue a 6-digit pairing code |
| `walgo_status` | Pairing state + connected wallet address/network |
| `walgo_init_template` | Scaffold from `portfolio` / `bio` / `landing` / `blank` |
| `walgo_list_files` | List paths in the in-browser draft |
| `walgo_read_file` | Read a file from the draft |
| `walgo_write_file` | Write a file to the draft |
| `walgo_delete_file` | Remove a file from the draft |
| `walgo_deploy` | Deploy current draft (browser signs) |
| `walgo_list_sites` | List sites owned by the connected wallet |
| `walgo_extend_epochs` | Extend Walrus storage duration |
| `walgo_link_suins` | Link a SuiNS name to a deployed site |

All proxy tools return `{ error: { code: "not_paired", … } }` (with `isError: true`) if no browser is connected.

## Development

```bash
npm test           # vitest, all 13 specs
npm run test:watch
```

Tests use an in-memory MCP transport plus a fake browser at the WS end — no wallet needed.

## Wire protocol

`src/protocol.ts` defines the messages exchanged with the browser. Browser implementations (today: walgo-web) must match this protocol.

## Mixed-content note

Browsers running on `https://web.walgo.xyz` connect to `ws://127.0.0.1:<port>` — Chrome/Edge treat 127.0.0.1 as a secure context. Firefox is stricter; if Firefox blocks the WS, run the dev server (`localhost:5173`) instead.

## License

MIT
