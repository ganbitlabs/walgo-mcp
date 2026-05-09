# Contributing to walgo-mcp

Thanks for considering a contribution. This is a small, opinionated codebase — most changes follow a few patterns. This doc captures them.

## Setup

```bash
git clone git@github.com:ganbitlabs/walgo-mcp.git
cd walgo-mcp
npm install
npm test                  # vitest, ~16 specs
```

For the Cloudflare Worker:

```bash
cd worker
npm install
npm run dev               # wrangler dev on http://localhost:8788
npm run typecheck
```

You'll need:

- **Node 22+** (the CI matrix pins 22.x)
- For worker work: a **Cloudflare account** + `wrangler login`. Free tier is enough for development; only deploy needs the account.
- For end-to-end testing: a **Sui wallet** (Slush, Suiet, etc.) on either mainnet or testnet, plus the [walgo-web](https://github.com/ganbitlabs/walgo-web) browser app running locally or pointed at production.

## How the code is organized

```
src/                      # Node stdio binary (used by Claude Code / Cursor as a local MCP)
  index.ts                # stdio entrypoint
  server.ts               # in-memory test harness for the MCP
  bridge.ts               # localhost WS bridge to the paired browser
  session.ts              # in-memory session state (code, paired ws, pending requests)
  tools.ts                # tool registry — all tools defined once, used by both transports
  protocol.ts             # wire protocol with the browser (MUST match worker/ + walgo-web)
  result.ts               # ok() / errorResult() helpers

worker/                   # Cloudflare Worker (hosted at mcp.walgo.xyz)
  src/index.ts            # fetch handler — routes /mcp + /pair + static endpoints
  src/session-do.ts       # per-session Durable Object: hosts MCP, holds browser ws
  src/coordinator-do.ts   # code → sessionDoId map with TTL + alarm-based sweep
  src/protocol.ts         # mirror of src/protocol.ts (kept in sync)
  src/static.generated.ts # bundled SKILL.md + install.sh (generated at build)

skill/SKILL.md            # the single source of truth for the agent playbook,
                          # served by the worker at /skill.md

tests/                    # vitest specs for the stdio side
```

The wire protocol lives in **three places** and they must stay identical:

1. `src/protocol.ts` (stdio)
2. `worker/src/protocol.ts` (worker)
3. `src/lib/mcp/protocol.ts` in [walgo-web](https://github.com/ganbitlabs/walgo-web) (browser)

If you change one, change all three. The PR template includes a checkbox for this.

## Adding a new tool

1. Add a literal to `RequestKind` in all three `protocol.ts` files.
2. Register it in `src/tools.ts` and `worker/src/tools.ts` (or wherever the worker's central registration lives) with the right `inputSchema`.
3. Add a handler in walgo-web's `src/lib/mcp/handlers.ts` that does the actual browser-side work.
4. Add a test case to `tests/proxy-tools.test.ts` if the tool is a simple proxy, or write a dedicated test if it has its own logic.
5. Update the skill at `skill/SKILL.md` with a recipe entry.

## Running end-to-end

The fastest dev loop is the in-memory test harness — no real browser, no wallet:

```bash
npm test                  # exercises bridge + tool registry against fake browser
```

For a real-browser smoke test (with a wallet), pair the local stdio binary against walgo-web running on `http://localhost:5173`:

```bash
# Terminal 1
npm run build
node dist/index.js

# Terminal 2 (in walgo-web)
npm run dev

# In your agent
claude mcp add walgo node /absolute/path/to/walgo-mcp/dist/index.js
# Then: call walgo_pair, paste code at https://localhost:5173/, sign in wallet
```

## Pull requests

- Branch off `main`. Name with a prefix: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
- Keep changes focused. Prefer multiple small PRs over one omnibus.
- The PR template runs you through the test plan — fill it in honestly.
- CI runs `tsc --noEmit` + `vitest` on every PR; both must pass.
- We squash-merge by default (clean history on `main`).

## Issues

- Use the bug or feature template (linked in the issue page).
- For something open-ended, start a [discussion](https://github.com/ganbitlabs/walgo-mcp/discussions) instead.
- For a bug in the wallet pairing UI / editor, file in [walgo-web](https://github.com/ganbitlabs/walgo-web/issues).

## Style

- TypeScript strict mode is on; no `any` unless genuinely necessary.
- Specific transition properties in CSS, no `transition: all`.
- Comments explain *why*, not *what*. The code says what; comments say why.
- No new dependencies without a real motivation. Default to writing it ourselves if it's <50 lines.

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
