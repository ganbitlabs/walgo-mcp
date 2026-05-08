import { SessionDO, SESSION_ID_HEADER } from "./session-do.js";
import { CoordinatorDO } from "./coordinator-do.js";

export { SessionDO, CoordinatorDO };

interface Env {
  SESSIONS: DurableObjectNamespace<SessionDO>;
  COORDINATOR: DurableObjectNamespace<CoordinatorDO>;
  PUBLIC_BASE_URL?: string;
  WALGO_WEB_URL?: string;
}

const PAIR_CODE_RE = /^\d{8}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Streamable HTTP MCP — agent side.
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const sessionId = request.headers.get("mcp-session-id") ?? crypto.randomUUID();
      const id = env.SESSIONS.idFromName(sessionId);
      const stub = env.SESSIONS.get(id);
      const headers = new Headers(request.headers);
      headers.set(SESSION_ID_HEADER, sessionId);
      // Normalize the path the DO sees so it can route consistently.
      const innerUrl = new URL(request.url);
      innerUrl.pathname = "/mcp";
      const inner = new Request(innerUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
      });
      return stub.fetch(inner);
    }

    // Browser bridge — paired tab side.
    if (url.pathname === "/pair") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const code = url.searchParams.get("code") ?? "";
      if (!PAIR_CODE_RE.test(code)) {
        return new Response("invalid code format", { status: 400 });
      }

      const coordId = env.COORDINATOR.idFromName("singleton");
      const coord = env.COORDINATOR.get(coordId);
      const lookup = await coord.fetch("https://coord.internal/lookup", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (!lookup.ok) {
        return new Response("invalid or expired code", { status: 401 });
      }
      const { sessionDoId } = (await lookup.json()) as { sessionDoId: string };

      const sessionId = env.SESSIONS.idFromString(sessionDoId);
      const stub = env.SESSIONS.get(sessionId);
      const innerUrl = new URL(request.url);
      innerUrl.pathname = "/pair";
      innerUrl.search = "";
      const inner = new Request(innerUrl.toString(), request);
      return stub.fetch(inner);
    }

    // Tiny landing page for humans who paste the URL into a browser.
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(LANDING_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};

const LANDING_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>walgo-mcp</title>
<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;max-width:560px;margin:8vh auto;padding:0 20px;color:#1c2731}code{background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:13px}h1{font-size:18px;margin-bottom:6px}p{color:#475569}a{color:#2563eb}</style>
</head><body>
<h1>walgo-mcp</h1>
<p>Hosted MCP bridge for <a href="https://walgo.xyz">walgo</a>. Configure your agent host (Claude Code, Cursor, Codex…) with this URL as a Streamable HTTP MCP endpoint:</p>
<p><code>${"https://"}<span id="host"></span>/mcp</code></p>
<p>Then open <a href="https://web.walgo.xyz">web.walgo.xyz</a>, connect your wallet, go to the MCP page, and paste the code your agent's <code>walgo_pair</code> tool returns.</p>
<script>document.getElementById("host").textContent=location.host</script>
</body></html>`;
