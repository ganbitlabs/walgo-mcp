# ADR 0005 — Deep-link pairing UX

**Status:** Accepted (2026-05-09)

## Context

`walgo_pair` issues an 8-digit code that the user must transfer from their agent's terminal to a wallet-connected browser tab. Default UX: the user reads the code, switches tabs, opens the MCP panel in walgo-web, types six or eight digits into an input, clicks Pair.

That's four context switches and a typing step. For a feature we want users to actually use, that friction matters.

## Decision

`walgo_pair` returns **both** a deep link and the raw code:

```json
{
  "code": "84392107",
  "deepLink": "https://web.walgo.xyz/pair/84392107",
  "expiresInSeconds": 300
}
```

walgo-web supports `/pair/:code` as a route — the page reads the path, prefills the code input, and auto-pairs the moment a wallet is connected.

Most modern terminals turn URLs into clickable links. So the flow becomes: agent prints link → user clicks → tab opens → already paired. One click.

The raw code is kept as a fallback for two real cases:

- **Cross-device** — user's agent is on a remote dev container or an SSH session; the printed link isn't clickable on the wallet-bearing device.
- **Cross-machine wallet** — user runs the agent on desktop, paired wallet is on phone. They type the code on the phone.

## Consequences

**Positive**

- Best path is one click. Doesn't fail on the worst path (manual code entry still works).
- The route works for both the hosted Worker (8-digit codes) and the local stdio binary (6-digit codes). The page accepts 6–8 digits.

**Negative**

- The deep-link URL contains the code. Codes are time-bound (5 min) and one-shot, so leakage to a third party (logs, screen share) is low-impact: even with the code, the third party still needs the user's wallet to do anything.
- The route requires `_redirects` (or equivalent SPA fallback) on Cloudflare Pages so `/pair/:code` resolves to `index.html`. Already shipped.

## Notes

The hosted Worker also includes the deep-link URL in `walgo_pair`'s response so agents can surface it consistently regardless of whether they're connected to the local stdio binary or the hosted Worker. The local stdio binary issues 6-digit codes (kept for backwards compat with earlier tests); the worker issues 8.
