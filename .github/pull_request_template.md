# Summary

<!-- 1–3 sentences. What changed, why. -->

## Changes

<!-- Bullet list. File-level if helpful, but no need to enumerate every line. -->

## Test plan

- [ ] `npm test` passes (stdio side)
- [ ] `cd worker && npm run typecheck` passes
- [ ] If wire protocol changed: edited `packages/protocol/src/index.ts` (not the re-export shims), and the change is backward compatible or has a matching walgo-web PR
- [ ] If a new tool was added or a tool's I/O shape changed: skill at `https://mcp.walgo.xyz/skill.md` updated (or noted as follow-up)
- [ ] Manual end-to-end pair + tool round-trip if behaviour-affecting

## Notes for reviewers

<!-- Anything non-obvious. Tradeoffs you considered. Things explicitly out of scope. -->
