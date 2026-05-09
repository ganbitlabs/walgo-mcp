# ADR 0001 — Paired browser architecture

**Status:** Accepted (2026-05-08)

## Context

walgo lets agents publish to Walrus + Sui. Every meaningful action — uploading blobs, registering a Site object, linking a SuiNS name, extending storage — requires a transaction signed by the user's wallet. The wallet lives in a browser extension (Slush, Suiet, etc.); it cannot be reached from a Node process or a Cloudflare Worker.

We needed a way for an agent (which is *not* in the browser) to drive walgo while keeping signing in the wallet (which *is* in the browser). Three options were considered:

1. **Custodial signer in the MCP server.** Agent passes intent → server holds a key and signs. Trivial UX, but moves custody to the operator. Hard "no" — walgo's value prop is "you own it".
2. **Agent prompts user to paste signed bytes back.** No infrastructure, but the UX is awful (user copy-pastes raw transaction hex between two windows for every chain action).
3. **Pair the agent's MCP session with the user's existing browser tab.** Agent talks to a small server; the browser tab connects to the same server with a one-shot pairing code; tools route from agent → server → browser → wallet → server → agent.

## Decision

Option 3. The architecture has three actors:

- **Agent** — speaks MCP (Streamable HTTP for the hosted Worker, stdio for the local binary).
- **walgo-mcp** — typed proxy. Holds a per-session bridge to one paired browser. Contains zero key material.
- **Browser tab** at `web.walgo.xyz` — runs `@mysten/dapp-kit`, `@mysten/sui`, `@mysten/walrus`. Receives request messages over WS and signs/executes via the wallet.

A pairing code (8 digits, 5-min TTL) bootstraps the WS connection. After pairing, the bridge proxies typed requests/responses by id correlation. The browser is the only actor that touches a private key.

## Consequences

**Positive**

- Custody never moves. The MCP operator (us, when hosted) cannot sign anything. The user retains full control via their existing wallet, no second wallet to manage.
- One protocol works for any agent host and any wallet. New agent hosts (Cursor, Codex, Gemini) just add an MCP entry; new wallets work as long as they expose the standard dapp-kit interface.
- The browser already has all the SDK code we need (Walrus WASM, Sui transaction builder, SuiNS) — we don't reimplement it on the server side.

**Negative**

- The user must keep the browser tab open for tools to work. We added a clear paired/disconnected status; the UX is acceptable but not invisible.
- Sessions are ephemeral. If the tab closes or the DO hibernates, the user re-pairs. We accept this; durable sessions would require server-held credentials which contradicts the whole point.
- Pair-code bootstrapping is a small attack surface. Mitigated by 8-digit codes, 5-min TTL, per-IP rate limit, and the fact that even a successful brute-force only joins someone *else's* MCP session — they still can't sign without their wallet.

## Alternatives rejected

- **OAuth-gated MCP** — would gate who can call `walgo_pair`, but the security boundary is the wallet, not the MCP. Adding OAuth raises friction without raising security.
- **Per-agent local proxy with embedded keys** — also moves custody. Same "no" as option 1 above.
