import { SessionDO, SESSION_ID_HEADER } from "./session-do.js";
import { CoordinatorDO } from "./coordinator-do.js";
import { SKILL_MD, INSTALL_SH } from "./static.generated.js";

export { SessionDO, CoordinatorDO };

interface Env {
  SESSIONS: DurableObjectNamespace<SessionDO>;
  COORDINATOR: DurableObjectNamespace<CoordinatorDO>;
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

    // Skill content — for any agent host that wants to fetch + read it.
    if (url.pathname === "/skill.md" || url.pathname === "/skill") {
      return new Response(SKILL_MD, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // One-line installer:  curl -fsSL https://mcp.walgo.xyz/install.sh | bash
    if (url.pathname === "/install.sh" || url.pathname === "/install") {
      return new Response(INSTALL_SH, {
        headers: {
          "content-type": "text/x-shellscript; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // Bootstrap prompt — paste this into any agent.
    if (url.pathname === "/prompt" || url.pathname === "/prompt.txt") {
      return new Response(BOOTSTRAP_PROMPT, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return new Response(LANDING_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};

const BOOTSTRAP_PROMPT = `You have an MCP server available at https://mcp.walgo.xyz/mcp (Streamable HTTP).
The walgo MCP lets you build, deploy, and manage Walrus Sites + SuiNS names by proxying tool calls to a paired walgo browser tab where the user's wallet lives.

Whenever I mention walgo, walrus sites, suins, .sui names, wal.app, or decentralized hosting on Sui, use this MCP. Read https://mcp.walgo.xyz/skill.md and follow it as a workflow playbook.

To start: call walgo_status. If unpaired, call walgo_pair, surface the deepLink + code to me, and wait for me to pair before invoking any other tool.
`;

const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>walgo-mcp — agent bridge for Walrus Sites</title>
  <meta name="description" content="Hosted MCP that lets agents (Claude Code, Cursor, Codex…) build, deploy, and manage walgo sites through a paired browser tab." />
  <style>
    :root { color-scheme: light dark; }
    *,*::before,*::after { box-sizing: border-box; }
    body {
      font: 15px/1.55 -apple-system, system-ui, "Segoe UI", sans-serif;
      max-width: 720px;
      margin: 6vh auto;
      padding: 0 24px;
      color: #1a2330;
      background: #fafbfc;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e6f1ff; background: #0a0f14; }
      pre, code { background: #11181f; color: #e6f1ff; border-color: #1f2a36; }
      a { color: #4da2ff; }
      .card { background: #11181f; border-color: #1f2a36; }
      hr { border-color: #1f2a36; }
    }
    h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.18em; color: #6b7a8a; margin-top: 32px; }
    p { color: #475569; margin: 8px 0; }
    @media (prefers-color-scheme: dark) { p { color: #94a3b8; } }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 1.5px 5px; border-radius: 3px; font-size: 13px; border: 1px solid transparent; }
    pre {
      background: #f1f5f9;
      padding: 12px 14px;
      border-radius: 5px;
      overflow-x: auto;
      font-size: 13px;
      border: 1px solid #e2e8f0;
      position: relative;
    }
    pre code { background: transparent; padding: 0; border: 0; font-size: 13px; }
    .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; background: #fff; margin: 10px 0; }
    .pill { display: inline-block; font-size: 11px; font-family: monospace; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 8px; border-radius: 12px; background: #4da2ff15; color: #2563eb; border: 1px solid #4da2ff40; }
    button.copy {
      position: absolute; top: 8px; right: 8px; font: inherit; font-size: 11px;
      padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 3px; background: #fff;
      cursor: pointer; opacity: 0.7; transition: opacity 0.1s;
    }
    button.copy:hover { opacity: 1; }
    @media (prefers-color-scheme: dark) {
      button.copy { background: #1f2a36; color: #e6f1ff; border-color: #334155; }
    }
    hr { border: 0; border-top: 1px solid #e2e8f0; margin: 28px 0; }
    .muted { color: #94a3b8; font-size: 13px; }
  </style>
</head>
<body>
  <p><span class="pill">walgo-mcp</span></p>
  <h1>Agent bridge for Walrus Sites</h1>
  <p>Hosted MCP that lets your agent (Claude Code, Cursor, Codex…) build, deploy, edit, and link walgo sites end-to-end. Your wallet stays in <a href="https://web.walgo.xyz">web.walgo.xyz</a>; every chain tx is signed there.</p>

  <h2>One-liner install</h2>
  <p class="muted">Drops the walgo skill in <code>~/.claude/skills/walgo</code> and registers the MCP with Claude Code (if installed).</p>
  <pre><code>curl -fsSL https://mcp.walgo.xyz/install.sh | bash</code><button class="copy">Copy</button></pre>

  <h2>Or set it up by hand</h2>

  <div class="card">
    <p><strong>Claude Code</strong></p>
    <pre><code>claude mcp add walgo --transport http https://mcp.walgo.xyz/mcp</code><button class="copy">Copy</button></pre>
  </div>

  <div class="card">
    <p><strong>Cursor</strong> — Settings → MCP → Add Server</p>
    <pre><code>{
  "name": "walgo",
  "transport": "http",
  "url": "https://mcp.walgo.xyz/mcp"
}</code><button class="copy">Copy</button></pre>
  </div>

  <div class="card">
    <p><strong>Codex / Continue / others</strong> — point at this Streamable HTTP URL:</p>
    <pre><code>https://mcp.walgo.xyz/mcp</code><button class="copy">Copy</button></pre>
  </div>

  <h2>Bootstrap prompt</h2>
  <p>Paste this into any agent that already has the MCP configured. Tells it the playbook lives at <code>/skill.md</code>.</p>
  <pre id="prompt"><code></code><button class="copy">Copy</button></pre>

  <h2>How pairing works</h2>
  <p>Call <code>walgo_pair</code>. The response gives you a <code>deepLink</code> like <code>https://web.walgo.xyz/pair/&lt;code&gt;</code> and an 8-digit <code>code</code>. Open the link (or paste the code) in the wallet-connected tab. The agent's tool calls then route through your paired browser, which signs every chain tx with your wallet.</p>

  <hr />

  <p class="muted">
    Source: <a href="https://github.com/ganbitlabs/walgo-mcp">github.com/ganbitlabs/walgo-mcp</a>
    · Skill (raw): <a href="/skill.md">/skill.md</a>
    · Bootstrap prompt: <a href="/prompt">/prompt</a>
  </p>
<script>
fetch("/prompt").then(r => r.text()).then(t => { document.querySelector("#prompt code").textContent = t; });
document.querySelectorAll("button.copy").forEach(btn => {
  btn.addEventListener("click", () => {
    const code = btn.previousElementSibling.textContent;
    navigator.clipboard.writeText(code);
    const old = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => btn.textContent = old, 1200);
  });
});
</script>
</body>
</html>`;
