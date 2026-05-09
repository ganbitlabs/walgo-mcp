import { describe, it, expect } from "vitest";
import { SELF, env } from "cloudflare:test";

// vitest-pool-workers needs this so `env` carries the bindings declared in
// wrangler.jsonc — specifically MINT_RATE_LIMITER and SESSIONS for the
// per-session mint-rate test below.
interface RateLimit {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}
interface RoutesEnv {
  MINT_RATE_LIMITER: RateLimit;
  SESSIONS: DurableObjectNamespace;
}
declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends RoutesEnv {}
}

describe("Worker routes", () => {
  describe("static content", () => {
    it("GET / serves the HTML landing page", async () => {
      const res = await SELF.fetch("https://example.com/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain("walgo-mcp");
      expect(body).toContain("https://mcp.walgo.xyz/mcp");
    });

    it("GET /skill.md serves the agent skill as markdown", async () => {
      const res = await SELF.fetch("https://example.com/skill.md");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
      const body = await res.text();
      expect(body).toContain("name: walgo");
      expect(body).toContain("walgo_pair");
    });

    it("GET /skill is an alias for /skill.md", async () => {
      const res = await SELF.fetch("https://example.com/skill");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    });

    it("GET /install.sh serves the bash installer", async () => {
      const res = await SELF.fetch("https://example.com/install.sh");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/x-shellscript/);
      const body = await res.text();
      expect(body).toMatch(/^#!\/usr\/bin\/env bash/);
      expect(body).toContain("https://mcp.walgo.xyz/mcp");
    });

    it("GET /prompt serves the bootstrap prompt as plain text", async () => {
      const res = await SELF.fetch("https://example.com/prompt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/plain/);
      const body = await res.text();
      expect(body).toContain("https://mcp.walgo.xyz/mcp");
      expect(body).toContain("walgo_pair");
    });

    it("unknown path returns 404", async () => {
      const res = await SELF.fetch("https://example.com/does-not-exist");
      expect(res.status).toBe(404);
    });
  });

  describe("/pair guards", () => {
    it("non-WS request returns 426", async () => {
      const res = await SELF.fetch("https://example.com/pair?code=12345678");
      expect(res.status).toBe(426);
    });

    it("missing code returns 400", async () => {
      const res = await SELF.fetch("https://example.com/pair", {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(400);
    });

    it("malformed code (too short) returns 400", async () => {
      const res = await SELF.fetch("https://example.com/pair?code=123", {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(400);
    });

    it("malformed code (non-numeric) returns 400", async () => {
      const res = await SELF.fetch("https://example.com/pair?code=abcdefgh", {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(400);
    });

    it("well-formed but unknown code returns 401 (coordinator lookup miss)", async () => {
      const res = await SELF.fetch("https://example.com/pair?code=99999999", {
        headers: { Upgrade: "websocket" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("/mcp", () => {
    it("MCP initialize returns 200 + session id header", async () => {
      const initBody = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      };
      const res = await SELF.fetch("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(initBody),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeTruthy();
    });

    // walgo_pair mints a one-shot code that lives in CoordinatorDO storage
    // for 5 minutes. Without a per-session rate limit, a single abuser can
    // mint thousands of codes/min — flood storage, drive up CF cost, and
    // (in conjunction with the failure-budget circuit breaker) thrash legit
    // users into constant re-pairs.
    it("rate-limits walgo_pair mints from a single MCP session", async () => {
      const sessionId = "mint-rate-test-session";
      const doId = env.SESSIONS.idFromName(sessionId).toString();

      // Pre-exhaust the session's mint budget (30/60s in wrangler.jsonc) on
      // the same key the SessionDO uses — the limiter is shared, so this
      // counts against the next walgo_pair call.
      for (let i = 0; i < 30; i++) {
        const { success } = await env.MINT_RATE_LIMITER.limit({ key: doId });
        expect(success).toBe(true);
      }

      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      };

      const init = await SELF.fetch("https://example.com/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      expect(init.status).toBe(200);

      const call = await SELF.fetch("https://example.com/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "walgo_pair", arguments: {} },
        }),
      });
      const body = await call.text();

      // The MCP SDK serialises tool errors as { isError: true, content: [...] }
      // with our errorResult helper embedding the JSON { error: { code, ... } }.
      expect(body).toContain("rate_limited");
    });
  });
});
