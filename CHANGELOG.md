# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-09

First tagged release. The MCP runs in two transports:

- **Streamable HTTP** Cloudflare Worker at `https://mcp.walgo.xyz/mcp` (recommended for end users)
- **Node stdio** binary in `dist/index.js` (for local dev / offline use)

### Tools

15 MCP tools, all routed through a paired walgo browser tab:

- Pairing: `walgo_pair`, `walgo_status`
- Draft files: `walgo_init_template`, `walgo_clear_draft`, `walgo_load_site`, `walgo_list_files`, `walgo_read_file`, `walgo_write_file`, `walgo_delete_file`
- Deploy / sites: `walgo_deploy`, `walgo_list_sites`
- SuiNS: `walgo_list_suins`, `walgo_resolve_suins`, `walgo_link_suins`
- Storage: `walgo_epoch_info`, `walgo_extend_epochs`

Tool I/O is documented via standard MCP `tools/list`. The skill at <https://mcp.walgo.xyz/skill.md> documents recipes (build new site, edit existing, link SuiNS, etc.) that agents follow.

### Worker endpoints

- `POST /mcp` — Streamable HTTP MCP for agents
- `GET /pair?code=…` (WS upgrade) — bridge endpoint for the paired browser
- `GET /` — landing page with per-client setup snippets (Claude Code, Cursor, VS Code, Claude Desktop, Claude.ai, ChatGPT, Codex CLI, Gemini CLI, Windsurf)
- `GET /skill.md` — single-source agent playbook
- `GET /install.sh` — `curl … | bash` installer (writes the skill, registers the MCP with Claude Code if available)
- `GET /prompt` — bootstrap prompt for any agent

### Architecture

- `SessionDO` — per-MCP-session Durable Object. Hosts the MCP via `createMcpHandler` + `WorkerTransport`. Owns the paired browser WebSocket and the pending-request map.
- `CoordinatorDO` — singleton DO mapping pairing codes to session IDs with a 5-minute TTL and alarm-based sweep.
- `@walgo/mcp-protocol` — internal workspace package that holds the canonical wire-protocol types; both transports re-export from it.

### Security

- Pairing-code-only auth (8-digit code, 5-minute TTL).
- Per-IP rate limiting on `/pair` (10 attempts / 60s) via Cloudflare's Rate Limiting binding.
- The server holds zero key material — every chain transaction is signed by the user's wallet inside the paired browser tab.
- Threat model documented in [ADR 0001](docs/adr/0001-paired-browser-architecture.md) and [ADR 0003](docs/adr/0003-pairing-code-only-auth.md).

### Repo / DX

- MIT License.
- AGENTS.md + `docs/agents/*` for engineering-skills configuration.
- CONTRIBUTING.md, SECURITY.md.
- `docs/adr/0001…0005` — five Architecture Decision Records.
- README rewritten for an external audience with mermaid diagrams (architecture flowchart + pairing sequence diagram).
- `examples/smoke.mjs` — standalone end-to-end smoke script.
- GitHub issue + PR templates with the wire-protocol triple-sync checklist.

### Tooling

- TypeScript 6 (strict, plus `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`).
- Node 22 runtime, `@types/node` 25.
- Vitest 4; `@cloudflare/vitest-pool-workers` for in-process worker integration tests via miniflare.
- Wrangler 4.
- 41 specs (24 stdio + 17 worker).
- GitHub Actions CI: typecheck, build, vitest, real-binary smoke (stdio); typecheck, vitest, `wrangler deploy --dry-run` (worker); `npm audit --audit-level=high`; CodeQL on every push/PR + weekly cron.
- Actions pinned to commit SHAs with version comments; Dependabot weekly grouped updates preserve that format.

[Unreleased]: https://github.com/ganbitlabs/walgo-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ganbitlabs/walgo-mcp/releases/tag/v0.1.0
