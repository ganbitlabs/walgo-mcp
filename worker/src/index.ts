import { SessionDO, SESSION_ID_HEADER } from "./session-do.js";
import { CoordinatorDO } from "./coordinator-do.js";
import { SKILL_MD, INSTALL_SH } from "./static.generated.js";

export { SessionDO, CoordinatorDO };

interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  SESSIONS: DurableObjectNamespace<SessionDO>;
  COORDINATOR: DurableObjectNamespace<CoordinatorDO>;
  PAIR_RATE_LIMITER: RateLimit;
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

      // Rate-limit before doing any work — code brute-forcing is the only
      // thing this endpoint can be abused for. Key on client IP; fall back
      // to a global bucket if the header is somehow missing.
      const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success: allowed } = await env.PAIR_RATE_LIMITER.limit({ key: `pair:${clientIp}` });
      if (!allowed) {
        return new Response("rate limit exceeded", {
          status: 429,
          headers: { "retry-after": "60" },
        });
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
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#0a0f14" />
  <title>walgo-mcp — agent bridge for Walrus Sites</title>
  <meta name="description" content="Hosted MCP that lets agents (Claude Code, Cursor, Codex…) build, deploy, and manage walgo sites through a paired browser tab." />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500&family=Rajdhani:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0f14;
      --card: linear-gradient(145deg, rgba(17,22,29,0.9), rgba(10,15,20,0.95));
      --code-bg: rgba(0,0,0,0.45);
      --text: #e0e6ed;
      --muted: #94a3b8;
      --dim: rgba(148,163,184,0.55);
      --border: rgba(255,255,255,0.08);
      --border-strong: rgba(255,255,255,0.14);
      --accent: #4da2ff;
      --accent-dim: rgba(77,162,255,0.10);
      --accent-border: rgba(77,162,255,0.30);
    }
    *,*::before,*::after { box-sizing: border-box; }
    html, body { background: var(--bg); color: var(--text); }
    body {
      font-family: 'Barlow', -apple-system, system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      margin: 0;
      min-height: 100vh;
      position: relative;
      -webkit-font-smoothing: antialiased;
    }
    .grid-bg {
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background-image:
        linear-gradient(rgba(77,162,255,0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(77,162,255,0.035) 1px, transparent 1px);
      background-size: 60px 60px;
      mask-image: radial-gradient(ellipse at top, rgba(0,0,0,0.7), transparent 70%);
    }
    .container {
      position: relative; z-index: 1;
      max-width: 760px;
      margin: 0 auto;
      padding: 64px 24px 96px;
    }
    .pill {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
      color: var(--accent);
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--accent-border);
      background: var(--accent-dim);
    }
    .pill::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 10px var(--accent);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 50% { opacity: 0.5; } }
    h1 {
      font-family: 'Rajdhani', sans-serif;
      font-weight: 700;
      font-size: 44px;
      line-height: 1.05;
      letter-spacing: -0.02em;
      margin: 16px 0 14px;
      color: #fff;
    }
    h1 .accent { color: var(--accent); }
    h2 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; letter-spacing: 0.28em; text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
      margin: 40px 0 12px;
    }
    .lede {
      color: var(--muted);
      max-width: 580px;
      margin: 0 0 8px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      background: var(--code-bg);
      padding: 1.5px 6px;
      border-radius: 3px;
      color: var(--text);
    }
    .panel {
      background: var(--card);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 20px 22px;
      margin: 12px 0;
      transition: border-color 0.15s;
    }
    .panel:hover { border-color: var(--border-strong); }
    .panel-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--text); font-weight: 500;
      margin: 0 0 10px;
    }
    .panel-title .meta { color: var(--dim); font-weight: 400; text-transform: none; letter-spacing: 0.02em; }
    .codeblock {
      position: relative;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      line-height: 1.55;
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 14px 64px 14px 16px;
      color: var(--accent);
      overflow-x: auto;
      white-space: pre;
    }
    .codeblock.muted-text { color: var(--text); }
    .codeblock.large { padding: 20px 80px 20px 22px; font-size: 14px; }
    .copy {
      position: absolute; top: 8px; right: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
      padding: 4px 9px;
      border: 1px solid var(--border);
      border-radius: 3px;
      background: rgba(255,255,255,0.02);
      color: var(--muted);
      cursor: pointer;
      transition: all 0.12s;
    }
    .copy:hover { color: var(--accent); border-color: var(--accent-border); background: var(--accent-dim); }
    .copy.copied { color: #34d399; border-color: rgba(52,211,153,0.35); background: rgba(52,211,153,0.08); }
    .footer {
      margin-top: 56px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--muted);
      display: flex; flex-wrap: wrap; gap: 18px;
    }
    .footer a { color: var(--muted); }
    .footer a:hover { color: var(--accent); }
    .hint { color: var(--dim); font-size: 13px; margin: -4px 0 12px; }
    .steps {
      list-style: decimal;
      padding-left: 22px;
      color: var(--muted);
      font-size: 14px;
      margin: 6px 0 12px;
    }
    .steps li { margin: 4px 0; }
    .steps strong { color: var(--text); font-weight: 500; }
    .install-button {
      display: inline-flex; align-items: center; gap: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--accent);
      padding: 6px 12px;
      border-radius: 3px;
      border: 1px solid var(--accent-border);
      background: var(--accent-dim);
      text-decoration: none;
      transition: all 0.12s;
    }
    .install-button:hover {
      background: rgba(77,162,255,0.18);
      border-color: var(--accent);
      text-decoration: none;
    }
    .corner {
      position: absolute;
      width: 8px; height: 8px;
      border-color: var(--border-strong);
      border-style: solid;
      border-width: 0;
    }
    .panel { position: relative; }
    .panel .corner.tl { top: -1px; left: -1px; border-top-width: 1px; border-left-width: 1px; }
    .panel .corner.tr { top: -1px; right: -1px; border-top-width: 1px; border-right-width: 1px; }
    .panel .corner.bl { bottom: -1px; left: -1px; border-bottom-width: 1px; border-left-width: 1px; }
    .panel .corner.br { bottom: -1px; right: -1px; border-bottom-width: 1px; border-right-width: 1px; }
    @media (max-width: 560px) {
      .container { padding: 40px 18px 64px; }
      h1 { font-size: 34px; }
      .codeblock { font-size: 12px; padding-right: 56px; }
      .copy { font-size: 8px; padding: 3px 7px; }
    }
  </style>
</head>
<body>
  <div class="grid-bg"></div>
  <main class="container">
    <span class="pill">walgo-mcp</span>
    <h1>Agent bridge for <span class="accent">Walrus</span> sites</h1>
    <p class="lede">Hosted MCP that lets your agent (Claude Code, Cursor, Codex…) build, deploy, edit, and link walgo sites end-to-end. Your wallet stays in <a href="https://web.walgo.xyz">web.walgo.xyz</a>; every chain transaction is signed there.</p>

    <h2>The endpoint</h2>
    <p class="hint">One Streamable HTTP URL — point any MCP-capable agent at this and you're 90% done.</p>
    <div class="codeblock large"><code>https://mcp.walgo.xyz/mcp</code><button class="copy" data-copy>Copy</button></div>

    <h2>One-liner install (Claude Code)</h2>
    <p class="hint">Drops the walgo skill at <code>~/.claude/skills/walgo</code> and registers the MCP with Claude Code if it's installed.</p>
    <div class="codeblock large"><code>curl -fsSL https://mcp.walgo.xyz/install.sh | bash</code><button class="copy" data-copy>Copy</button></div>

    <h2>Per-client setup</h2>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Cursor</p>
      <p class="hint" style="margin-top:-2px"><a href="cursor://anysphere.cursor-deeplink/mcp/install?name=walgo&config=eyJ1cmwiOiJodHRwczovL21jcC53YWxnby54eXovbWNwIn0=" class="install-button">→ One-click install</a></p>
      <p class="hint">Or manually — add to <code>.cursor/mcp.json</code>:</p>
      <div class="codeblock muted-text"><code>{
  "mcpServers": {
    "walgo": {
      "url": "https://mcp.walgo.xyz/mcp"
    }
  }
}</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">VS Code <span class="meta">/ GitHub Copilot</span></p>
      <p class="hint" style="margin-top:-2px"><a href="vscode:mcp/install?%7B%22name%22%3A%22walgo%22%2C%22config%22%3A%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.walgo.xyz%2Fmcp%22%7D%7D" class="install-button">→ One-click install</a></p>
      <p class="hint">Or manually — add to <code>.vscode/mcp.json</code>:</p>
      <div class="codeblock muted-text"><code>{
  "servers": {
    "walgo": {
      "type": "http",
      "url": "https://mcp.walgo.xyz/mcp"
    }
  }
}</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Claude Code</p>
      <div class="codeblock"><code>claude mcp add --scope user --transport http walgo https://mcp.walgo.xyz/mcp</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Claude Desktop</p>
      <ol class="steps">
        <li>Open <strong>Settings → Connectors</strong> (or <strong>Developer</strong> on older versions).</li>
        <li>Click <strong>Add custom connector</strong> / <strong>Add remote MCP server</strong>.</li>
        <li>Paste the URL:</li>
      </ol>
      <div class="codeblock"><code>https://mcp.walgo.xyz/mcp</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Claude.ai <span class="meta">— claude.ai/web</span></p>
      <ol class="steps">
        <li><strong>Settings → Connectors → Custom Connectors → Add Custom Connector</strong>.</li>
        <li>Paste the URL above. Name it <code>walgo</code>.</li>
      </ol>
      <p class="hint">Available on Pro / Team / Enterprise plans.</p>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">ChatGPT <span class="meta">— chat.openai.com</span></p>
      <ol class="steps">
        <li><strong>Settings → Connectors → Add Custom Connector</strong>.</li>
        <li>Paste the URL above. Name it <code>walgo</code>.</li>
      </ol>
      <p class="hint">Available on Plus / Pro / Team / Enterprise.</p>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Codex CLI</p>
      <div class="codeblock"><code>codex mcp add walgo --url https://mcp.walgo.xyz/mcp</code><button class="copy" data-copy>Copy</button></div>
      <p class="hint" style="margin-top:10px">Or add to <code>~/.codex/config.toml</code>:</p>
      <div class="codeblock muted-text"><code>[mcp_servers.walgo]
url = "https://mcp.walgo.xyz/mcp"</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Gemini CLI</p>
      <div class="codeblock"><code>gemini mcp add -t http walgo https://mcp.walgo.xyz/mcp</code><button class="copy" data-copy>Copy</button></div>
      <p class="hint" style="margin-top:10px">Or add to <code>~/.gemini/settings.json</code>:</p>
      <div class="codeblock muted-text"><code>{
  "mcpServers": {
    "walgo": {
      "httpUrl": "https://mcp.walgo.xyz/mcp"
    }
  }
}</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Windsurf</p>
      <p class="hint">Add to <code>~/.codeium/windsurf/mcp_config.json</code>:</p>
      <div class="codeblock muted-text"><code>{
  "mcpServers": {
    "walgo": {
      "serverUrl": "https://mcp.walgo.xyz/mcp"
    }
  }
}</code><button class="copy" data-copy>Copy</button></div>
    </div>

    <div class="panel">
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <p class="panel-title">Other clients <span class="meta">— Continue, Zed, anything that speaks Streamable HTTP MCP</span></p>
      <p class="hint">Just point them at the endpoint URL. Field names vary slightly (<code>url</code>, <code>httpUrl</code>, <code>serverUrl</code>) — consult your client's docs.</p>
    </div>

    <h2>Bootstrap prompt</h2>
    <p class="hint">Paste into any agent that already has the MCP configured. Points it at the playbook at <code>/skill.md</code>.</p>
    <div class="codeblock muted-text" id="prompt-box"><code id="prompt-text">loading…</code><button class="copy" data-copy>Copy</button></div>

    <h2>How pairing works</h2>
    <p class="hint">Call <code>walgo_pair</code> from your agent. The response includes a <code>deepLink</code> like <code>https://web.walgo.xyz/pair/&lt;code&gt;</code> and an 8-digit <code>code</code>. Open the link (or paste the code) in the wallet-connected browser tab. After that, every tool call routes through your paired browser, where your wallet signs each chain transaction.</p>

    <div class="footer">
      <a href="https://github.com/ganbitlabs/walgo-mcp">github / source</a>
      <a href="/skill.md">/skill.md</a>
      <a href="/prompt">/prompt</a>
      <a href="https://walgo.xyz">walgo.xyz</a>
    </div>
  </main>

  <script>
    fetch("/prompt")
      .then(r => r.text())
      .then(t => { document.getElementById("prompt-text").textContent = t.trimEnd(); })
      .catch(() => { document.getElementById("prompt-text").textContent = "(failed to load /prompt)"; });

    document.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", () => {
        const text = btn.previousElementSibling.textContent;
        navigator.clipboard.writeText(text).then(() => {
          const original = btn.textContent;
          btn.textContent = "Copied";
          btn.classList.add("copied");
          setTimeout(() => { btn.textContent = original; btn.classList.remove("copied"); }, 1400);
        });
      });
    });
  </script>
</body>
</html>`;
