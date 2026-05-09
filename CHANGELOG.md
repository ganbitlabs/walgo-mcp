# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repo metadata: `LICENSE` (MIT), `AGENTS.md`, `docs/agents/*` (engineering-skills config).
- `CONTRIBUTING.md`, GitHub issue + PR templates, GitHub Actions CI (`tsc --noEmit` + `vitest` on every PR).
- `.editorconfig`.
- `docs/adr/0001…0005` — five initial Architecture Decision Records.
- `examples/smoke.mjs` — standalone end-to-end smoke script.
- README rewritten for an external audience with mermaid diagrams (architecture flowchart + pairing sequence).

## [0.1.0] — 2026-05-08

Initial public-ready release. The MCP runs in two transports:

- **Streamable HTTP** Cloudflare Worker at `https://mcp.walgo.xyz/mcp` (recommended for end users)
- **Node stdio** binary in `dist/index.js` (for local dev / offline use)

### Tools

15 MCP tools, all routed through a paired walgo browser tab:

- Pairing: `walgo_pair`, `walgo_status`
- Draft files: `walgo_init_template`, `walgo_clear_draft`, `walgo_load_site`, `walgo_list_files`, `walgo_read_file`, `walgo_write_file`, `walgo_delete_file`
- Deploy / sites: `walgo_deploy`, `walgo_list_sites`
- SuiNS: `walgo_list_suins`, `walgo_resolve_suins`, `walgo_link_suins`
- Storage: `walgo_epoch_info`, `walgo_extend_epochs`

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

### Security model

- Pairing-code-only auth (8 digits, 5-minute TTL, per-IP rate limit on `/pair`).
- The server holds zero key material. Every chain transaction is signed by the user's wallet inside the paired browser tab.

[Unreleased]: https://github.com/ganbitlabs/walgo-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ganbitlabs/walgo-mcp/releases/tag/v0.1.0
