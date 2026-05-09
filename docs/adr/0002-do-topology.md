# ADR 0002 — Worker + Durable Object topology

**Status:** Accepted (2026-05-08)

## Context

The hosted MCP needs:

- A **Streamable HTTP** endpoint so any agent host can connect.
- A **WebSocket** endpoint so the user's browser tab can pair.
- **Per-session state**: which browser is paired, pending request/response correlation, the MCP transport's session id.
- **Pairing code lookup**: short-lived `code → session` map with strong consistency (an expired code must not pair, even one ms past TTL).

Stateless Workers can't hold the bridge WebSocket or pending request map across requests. We needed something stateful.

## Decision

Two Durable Object classes on a single Worker:

- **`SessionDO`** — one instance per MCP session (keyed by the session id the SDK assigns).
  - Hosts the MCP server via `createMcpHandler` + `WorkerTransport`.
  - Owns the paired browser WebSocket (one per session).
  - Maintains the pending-request map for id correlation.
  - State persisted to `ctx.storage` so the transport's session id survives DO hibernation.
- **`CoordinatorDO`** — singleton (`idFromName("singleton")`).
  - Map `code → sessionDoId` with `expiresAt` timestamps.
  - Alarm-based sweep every 60s removes expired entries.
  - `lookup` deletes the entry on success (one-shot codes).

The Worker fetch handler routes by URL:

- `POST /mcp` → `SESSIONS.get(idFromName(sessionId))` (sessionId from `mcp-session-id` header, generated if absent)
- `GET /pair?code=…` (WS upgrade) → `Coordinator.lookup(code)` → `SESSIONS.get(idFromString(...))` → forwards the upgrade

## Consequences

**Positive**

- Strong consistency on code lookup (DO storage, not KV). An expired code can't slip through during eventual-consistency propagation.
- Session state survives DO hibernation as long as `WorkerTransport.storage` writes it (which it does, via `ctx.storage`). Cold-start cost is one storage read.
- Single Worker = single deploy unit, single observability surface, no cross-worker auth.
- Mid-session DO hibernation is safe: when the WS reconnects (or the user re-pairs), the new instance reads the same persisted state.

**Negative**

- Two DO classes is more moving parts than one. We pay this cost because separating the singleton coordinator from per-session DOs is the only way to do code-to-session lookup without a global lock on every session DO.
- Browsers must reconnect if their WS drops mid-session. The bridge already handles this; the user just sees a brief "reconnecting" state and resumes.

## Alternatives rejected

- **KV for the code map.** Eventually consistent — an expired code could pair during propagation.
- **One DO with a fan-out method for lookups.** Conflates concerns; every session DO would need to know every other session's code which doesn't scale.
- **Single Agent class hosting MCP via `serveSSE`.** SSE is deprecated in favor of Streamable HTTP, and `McpAgent` doesn't expose a way to route a *different* WS upgrade through the same DO instance — we needed lower-level control.
