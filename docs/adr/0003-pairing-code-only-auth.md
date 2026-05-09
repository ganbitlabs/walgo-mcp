# ADR 0003 — Pairing-code-only auth (no OAuth)

**Status:** Accepted (2026-05-08)

## Context

Most hosted MCP servers OAuth-gate `/mcp` so unauthorized agents can't call tools. The Cloudflare Workers OAuth Provider (and `mcp-remote`) make this easy. Should walgo-mcp do the same?

## Decision

**No.** A short-lived pairing code is the only auth mechanism. Anyone can configure `https://mcp.walgo.xyz/mcp` and call `walgo_pair`; the result is useless until a wallet-connected browser tab supplies the matching code.

## Reasoning

The security boundary in walgo is **the user's wallet**, not the MCP. Concretely:

- The MCP holds zero capabilities. Every action (read files, deploy, link SuiNS, extend) is forwarded to the paired browser. The server has no API keys, no funds, no signing material.
- An unpaired session can mint pair codes but can't call any other tool. All proxy tools fail with `not_paired` until a browser pairs.
- A paired session can only act on the wallet that's connected in the paired tab. Pairing isn't authorization to do anything — it's a routing primitive.

Adding OAuth would gate `walgo_pair`. That doesn't reduce the actual risk surface; it just makes the install flow heavier. We'd be adding an auth layer that protects nothing the wallet doesn't already protect.

## Threat model

The actual risks and how we mitigate them without OAuth:

| Risk | Mitigation |
|---|---|
| Anonymous pair-code flood (DDoS) | Per-IP rate limit on `/pair` (10/60s) and per-MCP-session rate limit on `walgo_pair` mints (30/60s, keyed on the SessionDO id so a noisy agent can't exhaust Coordinator storage) |
| Code brute-forcing (single attacker) | 8 digits = 100M space, 5-min TTL, per-IP rate limit on `/pair` (10/60s) |
| Code brute-forcing (botnet, defeats per-IP) | Coordinator-wide failure-budget circuit breaker — once lookups miss more than 50 times in any 60s window, every currently-registered code is invalidated; legit users re-pair on a fresh code the attacker hasn't seen |
| Stolen code (shoulder surf, screen share) | Codes are one-shot and time-bound. Even a stolen code only joins someone else's MCP session, where signing still requires the legitimate user's wallet popup |
| Hostile MCP operator | Mitigated structurally by the no-key-on-server architecture (ADR 0001). Worst case a malicious operator could request `walgo_deploy` with weird metadata, but the user sees the wallet popup and rejects |

## Consequences

**Positive**

- Onboarding is one URL. No OAuth dance, no token refresh, no browser redirects in the agent host's flow.
- No secrets in the server (no client_secret, no JWT signing key).
- Works identically for any agent host (Claude Code / Cursor / Codex / Gemini / ChatGPT custom connector / Claude.ai connector). OAuth support varies.

**Negative**

- A paired session is more accessible to "join in" than an OAuth-gated one. We accept this because the wallet is the real gate.
- We give up the ability to attribute usage to a logged-in identity. If we later need this (analytics, billing, user-scoped quotas), we'd add it as a layer *on top of* the pairing primitive, not replacing it.

## Revisit if

- We want to charge per agent / per user (need an identity)
- We add server-side capabilities that aren't proxied to the browser (then the server *does* have something to protect)
- The community converges on a standard MCP auth pattern that's lighter than OAuth and we want to plug in
