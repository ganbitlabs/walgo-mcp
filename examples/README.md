# Examples

Standalone scripts that exercise walgo-mcp without needing a real wallet.

## `smoke.mjs`

End-to-end stdio + WS smoke test. Spawns the local stdio binary, simulates a paired browser via WebSocket, runs through `walgo_pair → walgo_status → walgo_init_template → walgo_list_files → walgo_read_file`.

Useful as:

- A first-run sanity check after `npm run build`
- A reference for what the wire protocol looks like in practice
- A starting point for your own MCP-driven scripts

```bash
npm install      # if you haven't already
npm run build
node examples/smoke.mjs
```

Expected output:

```
→ spawning walgo-mcp (stdio) on WS port 49901
→ walgo_pair
  code: 482917
→ fake browser pairing
  paired ✓
→ walgo_status
  { paired: true, address: '0xsmoke', network: 'mainnet' }
→ walgo_init_template { template: 'blank', siteName: 'smoke' }
  { template: 'blank', fileCount: 2, paths: [ '/index.html', '/style.css' ] }
→ walgo_list_files
  { files: [ … ] }
→ walgo_read_file { path: '/index.html' }
  { path: '/index.html', content: '<!doctype html>…' }

all good ✓
```

The fake-browser handlers in `smoke.mjs` only implement the three tools the script exercises (`init_template`, `list_files`, `read_file`); other tool calls return `unhandled`. That's enough to demonstrate the round-trip without pulling in the real walgo-web client code.
