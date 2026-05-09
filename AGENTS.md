# AGENTS.md

Repository-wide context for agent tools (Claude Code, Cursor, Codex, Continue, etc.).

walgo-mcp is the MCP server that bridges agents to a paired [walgo](https://web.walgo.xyz) browser tab. Two transports share most code:

- **Node stdio** (`src/`) — local binary, used for development and offline use.
- **Cloudflare Worker** (`worker/`) — hosted at `https://mcp.walgo.xyz/mcp`, the canonical public endpoint.

The wire protocol between the server and the paired browser is defined in `src/protocol.ts` (and mirrored in `worker/src/protocol.ts` and walgo-web's `src/lib/mcp/protocol.ts`). All three must stay in sync.

## Agent skills

### Issue tracker

Issues live in GitHub at [`ganbitlabs/walgo-mcp`](https://github.com/ganbitlabs/walgo-mcp), accessed via the `gh` CLI. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

Canonical defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs` as terms and decisions get resolved). See [`docs/agents/domain.md`](docs/agents/domain.md).
