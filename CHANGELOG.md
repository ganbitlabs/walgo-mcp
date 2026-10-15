# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Dependency advisories cleared** ([#51](https://github.com/ganbitlabs/walgo-mcp/pull/51)). `@modelcontextprotocol/sdk` moves to `^1.32.1`, and a root `overrides` entry makes `agents@0.12.x` use it instead of its pinned 1.29.0. Transitive packages such as `ai`, `@babel/core`, `hono`, `ws`, and `proxy-addr` move to patched versions inside their existing ranges. `npm audit --omit=dev --audit-level=high` passes again.

## [0.1.1] — 2026-05-09

walgo-mcp went **public** on this day. Two security-hardening landings preceded the flip; both close attack vectors that per-IP rate limiting alone leaves open.

### Security

- **Coordinator failure-budget circuit breaker** ([#27](https://github.com/ganbitlabs/walgo-mcp/pull/27)). `CoordinatorDO` now tracks lookup-failure count over a rolling 60s window. Once misses exceed 50, every currently-registered pairing code is invalidated — legit users re-pair on a fresh code the attacker hasn't seen. Defeats botnet brute-force on the 8-digit pairing code (the per-IP `/pair` rate limit only slows a single attacker; a distributed attacker can still cycle the namespace under the per-IP cap). Successful lookups don't count against the budget. Two new `vitest-pool-workers` tests cover the threshold lockout and the success-exempt invariant.
- **Per-session mint rate limit on `walgo_pair`** ([#28](https://github.com/ganbitlabs/walgo-mcp/pull/28)). New `MINT_RATE_LIMITER` Cloudflare rate-limit binding (30 mints / 60s, keyed on `SessionDO` id). Stops a noisy agent from flooding `CoordinatorDO` storage with thousands of one-shot codes/min. Per-session keying isolates the abuser without penalising legit users sharing an egress (CI runners, NAT). `walgo_pair` returns a structured `rate_limited` error result when the budget is exhausted, mirroring the proxy tools' `BridgeError` shape.

ADRs 0001 and 0003 + SECURITY.md updated to reflect both mitigations in the threat-model tables.

### CI / tooling

- **CodeQL workflow gets `actions: read`** ([#29](https://github.com/ganbitlabs/walgo-mcp/pull/29)). The analyze action's telemetry post-step calls the workflow-runs API; without this permission the job failed even when the scan itself succeeded. (On the private repo, GitHub Advanced Security was the deeper blocker — that becomes free with the public flip, so CodeQL goes green from this release on.)

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

[Unreleased]: https://github.com/ganbitlabs/walgo-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/ganbitlabs/walgo-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ganbitlabs/walgo-mcp/releases/tag/v0.1.0
