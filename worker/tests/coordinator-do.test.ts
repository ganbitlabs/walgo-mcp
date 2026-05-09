import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

// vitest-pool-workers requires this typing so `env` is properly typed.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

interface Env {
  COORDINATOR: DurableObjectNamespace;
}

/**
 * Talk to the CoordinatorDO over its public fetch interface (POST /register,
 * POST /lookup) — exactly what the Worker fetch handler does in production.
 *
 * `doName` scopes a fresh Coordinator instance per test where state isolation
 * matters (e.g. lockout tests that pollute the failure-budget counter).
 */
async function register(
  code: string,
  sessionDoId: string,
  ttlMs: number,
  doName = "singleton",
): Promise<void> {
  const id = env.COORDINATOR.idFromName(doName);
  const stub = env.COORDINATOR.get(id);
  const res = await stub.fetch("https://coord.internal/register", {
    method: "POST",
    body: JSON.stringify({ code, sessionDoId, ttlMs }),
  });
  expect(res.ok).toBe(true);
}

async function lookup(code: string, doName = "singleton"): Promise<string | null> {
  const id = env.COORDINATOR.idFromName(doName);
  const stub = env.COORDINATOR.get(id);
  const res = await stub.fetch("https://coord.internal/lookup", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!res.ok) return null;
  const { sessionDoId } = (await res.json()) as { sessionDoId: string };
  return sessionDoId;
}

describe("CoordinatorDO", () => {
  it("registers a code, looks it up once, then it's gone (one-shot)", async () => {
    const code = "11111111";
    await register(code, "session-A", 60_000);

    expect(await lookup(code)).toBe("session-A");
    // Second lookup must return null — codes are one-shot.
    expect(await lookup(code)).toBeNull();
  });

  it("an unknown code returns null", async () => {
    expect(await lookup("00000000")).toBeNull();
  });

  it("an expired code returns null even if not swept yet", async () => {
    const code = "22222222";
    // Register with a TTL of 1ms — it's "expired" essentially immediately.
    await register(code, "session-B", 1);

    // Wait long enough that the entry's expiresAt is in the past, but
    // before the alarm fires (alarm is 60s in the DO).
    await new Promise((r) => setTimeout(r, 50));

    // The DO checks expiresAt at lookup time and returns null even though the
    // sweep hasn't run yet.
    expect(await lookup(code)).toBeNull();
  });

  it("registering the same code twice replaces the prior entry", async () => {
    const code = "33333333";
    await register(code, "session-C", 60_000);
    await register(code, "session-D", 60_000);

    // The second register supersedes — lookup returns the latest sessionDoId.
    expect(await lookup(code)).toBe("session-D");
  });

  it("two distinct codes don't collide", async () => {
    await register("44444444", "session-E", 60_000);
    await register("55555555", "session-F", 60_000);

    expect(await lookup("44444444")).toBe("session-E");
    expect(await lookup("55555555")).toBe("session-F");
  });

  // Brute-force lockout: a burst of failed lookups (per-IP rate limiting only
  // slows a single attacker, not a botnet) trips a global circuit breaker that
  // invalidates every currently-registered code. Forces in-flight legit pairs
  // to re-pair on a fresh code the attacker hasn't seen.
  describe("global failure budget lockout", () => {
    // Scope each test to its own Coordinator instance — the failure-budget
    // counter persists across tests on a shared DO and would poison neighbours.
    const lockoutDo = (name: string) => `lockout-${name}`;

    it("invalidates all currently-registered codes once the failure threshold is exceeded", async () => {
      const scope = lockoutDo("threshold");
      const valid = "60000001";
      await register(valid, "session-victim", 60_000, scope);

      // FAILURE_THRESHOLD = 50 in coordinator-do.ts. 51 misses pushes count to 51,
      // which exceeds the threshold and trips the circuit breaker.
      for (let i = 0; i < 51; i++) {
        const miss = String(70_000_000 + i).padStart(8, "0");
        expect(await lookup(miss, scope)).toBeNull();
      }

      expect(await lookup(valid, scope)).toBeNull();
    });

    it("successful lookups don't count against the failure budget", async () => {
      const scope = lockoutDo("success-exempt");
      const victim = "82000001";
      await register(victim, "session-victim", 60_000, scope);

      // 49 misses — one below the lockdown threshold of 50.
      for (let i = 0; i < 49; i++) {
        expect(await lookup(String(83_000_000 + i).padStart(8, "0"), scope)).toBeNull();
      }

      // 10 successful pairings. If any of these incremented the budget, we'd
      // pass 50 and the victim code below would be wiped.
      for (let i = 0; i < 10; i++) {
        const c = String(84_000_000 + i).padStart(8, "0");
        await register(c, `session-${i}`, 60_000, scope);
        expect(await lookup(c, scope)).toBe(`session-${i}`);
      }

      expect(await lookup(victim, scope)).toBe("session-victim");
    });
  });
});
