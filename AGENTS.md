# AGENTS.md

Repository-wide context for agent tools (Claude Code, Cursor, Codex, Continue, etc.).

walgo-mcp is the MCP server that bridges agents to a paired [walgo](https://web.walgo.xyz) browser tab. Two transports share most code:

- **Node stdio** (`src/`) — local binary, used for development and offline use.
- **Cloudflare Worker** (`worker/`) — hosted at `https://mcp.walgo.xyz/mcp`, the canonical public endpoint.

The wire protocol between the server and the paired browser is defined once in `packages/protocol/src/index.ts` (`@walgo/mcp-protocol`). `src/protocol.ts` and `worker/src/protocol.ts` re-export it. The browser app keeps its own copy, so protocol changes must stay backward compatible or ship in lockstep with it.

## Commands

- Stdio server: `npm ci`, then `npm run build` and `npm test`.
- Worker: `cd worker && npm run typecheck && npm test`.

## Agent skills

### Issue tracker

GitHub Issues in [`ganbitlabs/walgo-mcp`](https://github.com/ganbitlabs/walgo-mcp), through the `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

The five canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root (`GLOSSARY.md` is created lazily as terms get resolved). See [`docs/agents/domain.md`](docs/agents/domain.md).
