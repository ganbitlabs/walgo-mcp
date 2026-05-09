# Security policy

## Reporting a vulnerability

Email **security@walgo.xyz** with details. Don't open a public GitHub issue for vulnerabilities.

Please include:

- A description of the issue and what an attacker could do with it
- Steps to reproduce, or a proof-of-concept if you have one
- Whether you've disclosed the issue elsewhere

We'll acknowledge receipt within 72 hours and aim to ship a fix within 14 days for high-severity issues. We're a small team — if you don't hear back, ping us once on the same email thread.

## What's in scope

walgo-mcp covers:

- The Node stdio binary in `src/`
- The Cloudflare Worker + Durable Objects in `worker/`
- The wire protocol between server and paired browser tab
- The `/install.sh` and `/skill.md` endpoints

Things explicitly **out of scope**:

- The user's wallet itself (Slush, Suiet, etc.) — report to that vendor.
- The walgo browser app at `web.walgo.xyz` — that's a separate (private) repo. Email the same address; we'll route it.
- Walrus / Sui / SuiNS protocol-level issues — report upstream.

## Threat model summary

The detailed reasoning is in the ADRs ([0001](docs/adr/0001-paired-browser-architecture.md), [0003](docs/adr/0003-pairing-code-only-auth.md)) — short version:

- The server holds **zero key material**. Every chain transaction is signed by the user's wallet inside the paired browser tab. A compromised walgo-mcp host can route tool calls but can't sign anything without a wallet popup the user rejects.
- The pairing code is the bootstrap primitive, not the security boundary. 8 digits + 5-min TTL + per-IP rate limit makes brute-forcing one specific code statistically infeasible for a single attacker. A botnet that defeats per-IP also can't get far: the Coordinator DO trips a global circuit breaker once lookups miss more than 50 times in any 60s window, invalidating every currently-registered code and forcing legit users to re-pair on something the attacker hasn't seen. A successfully-guessed code joins someone else's MCP session, where signing still requires the legitimate user's wallet.
- The wire protocol is JSON-only with strict id-based request/response correlation; malformed messages are silently dropped (see `tests/pairing-edges.test.ts`).

If you find a way around any of these — please email us.

## Known limitations

We document these openly so people don't waste time reporting them as bugs:

- **Cross-device pairing**: a code typed on a different device than the agent is shown on is, by design, not bound to the agent's IP. This is intentional to support the "agent on remote dev container, wallet on phone" workflow.
- **WS to `ws://localhost`**: Firefox blocks WebSocket connections from `https://web.walgo.xyz` to `ws://127.0.0.1:<port>`. Chrome and Edge allow it via the secure-context exception for localhost. We accept this in exchange for not requiring TLS for the local stdio binary.

## Public repo, private incidents

Issues filed here are public the moment they're created. If you're not sure whether something is sensitive, err on the email side — we can always ask you to file a public issue if it isn't.
