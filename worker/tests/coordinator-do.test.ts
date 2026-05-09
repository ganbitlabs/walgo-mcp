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
 */
async function register(code: string, sessionDoId: string, ttlMs: number): Promise<void> {
  const id = env.COORDINATOR.idFromName("singleton");
  const stub = env.COORDINATOR.get(id);
  const res = await stub.fetch("https://coord.internal/register", {
    method: "POST",
    body: JSON.stringify({ code, sessionDoId, ttlMs }),
  });
  expect(res.ok).toBe(true);
}

async function lookup(code: string): Promise<string | null> {
  const id = env.COORDINATOR.idFromName("singleton");
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
});
