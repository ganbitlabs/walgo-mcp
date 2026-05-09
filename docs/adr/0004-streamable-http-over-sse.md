# ADR 0004 — Streamable HTTP transport (over SSE)

**Status:** Accepted (2026-05-08)

## Context

The Model Context Protocol defines two transports for remote servers:

- **Server-Sent Events (SSE)** — original remote transport. Server pushes via long-lived `text/event-stream`; client posts on a separate endpoint.
- **Streamable HTTP** — introduced in MCP spec 2025-03-26. Single endpoint, bidirectional via chunked HTTP responses. Replaces SSE for new servers.

The Cloudflare Agents SDK supports both. `McpAgent.serve()` defaults to Streamable HTTP. `createMcpHandler` is also Streamable HTTP.

## Decision

Streamable HTTP only. SSE is not supported.

## Consequences

**Positive**

- Aligned with the current MCP spec. SSE is officially deprecated.
- One endpoint (`/mcp`) instead of two (SSE flavor needs a separate POST endpoint for client→server). Simpler routing, simpler observability.
- Matches what every modern MCP client expects. Claude Code, Cursor, Codex CLI, Gemini CLI, Continue, ChatGPT/Claude.ai custom connectors all support Streamable HTTP.

**Negative**

- Older clients that *only* support SSE can't connect. We checked the matrix; in practice this is no one we care about. If a request comes in for SSE we'd reconsider.
- `mcp-remote` (the bridge for clients that only support stdio) translates between stdio and Streamable HTTP fine, so users on stdio-only clients still work.

## Notes

The `WorkerTransport` from `agents/mcp` handles the protocol layer. We pass it a `storage` adapter so the transport's session id (assigned on `initialize`) survives DO hibernation. The session id is what the Worker uses to route subsequent requests via `mcp-session-id` header → `SESSIONS.idFromName(...)` (see ADR 0002).
