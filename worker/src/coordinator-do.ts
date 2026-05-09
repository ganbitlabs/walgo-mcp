import { DurableObject } from "cloudflare:workers";

interface PairingRecord {
  sessionDoId: string;
  expiresAt: number;
}

const SWEEP_INTERVAL_MS = 60_000;
const KEY_PREFIX = "code:";
const FAILURES_KEY = "failures";
// Brute-force circuit breaker: once more than FAILURE_THRESHOLD lookups miss
// inside a single FAILURE_WINDOW_MS window, every currently-registered code
// is invalidated. The per-IP rate limit on /pair caps a single attacker; this
// caps a botnet (which would otherwise cycle the 8-digit space against a
// known-active code without tripping any per-IP bucket).
const FAILURE_WINDOW_MS = 60_000;
const FAILURE_THRESHOLD = 50;

interface FailureWindow {
  count: number;
  windowStartMs: number;
}

/**
 * Coordinator DO maps short pairing codes to SessionDO ids with a TTL.
 *
 *   register(code, sessionDoId, ttlMs)  →  ok
 *   lookup(code)                        →  sessionDoId | null  (deletes on hit)
 *
 * Strong consistency matters: an expired code must not be paired even one ms
 * past its TTL. A DO with `ctx.storage` gives us that; KV (eventually
 * consistent) does not.
 */
export class CoordinatorDO extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/register") {
      const { code, sessionDoId, ttlMs } = (await request.json()) as {
        code: string;
        sessionDoId: string;
        ttlMs: number;
      };
      await this.register(code, sessionDoId, ttlMs);
      return Response.json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/lookup") {
      const { code } = (await request.json()) as { code: string };
      const sessionDoId = await this.lookupAndConsume(code);
      if (!sessionDoId) {
        return Response.json({ error: "invalid_or_expired_code" }, { status: 404 });
      }
      return Response.json({ sessionDoId });
    }

    return new Response("not found", { status: 404 });
  }

  async register(code: string, sessionDoId: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    await this.ctx.storage.put<PairingRecord>(KEY_PREFIX + code, { sessionDoId, expiresAt });
    await this.ensureAlarm();
  }

  async lookupAndConsume(code: string): Promise<string | null> {
    const key = KEY_PREFIX + code;
    const record = await this.ctx.storage.get<PairingRecord>(key);
    if (record) {
      await this.ctx.storage.delete(key);
      if (record.expiresAt >= Date.now()) return record.sessionDoId;
    }
    await this.recordFailure();
    return null;
  }

  private async recordFailure(): Promise<void> {
    const now = Date.now();
    const prior = await this.ctx.storage.get<FailureWindow>(FAILURES_KEY);
    const window: FailureWindow =
      prior && now - prior.windowStartMs < FAILURE_WINDOW_MS
        ? { count: prior.count + 1, windowStartMs: prior.windowStartMs }
        : { count: 1, windowStartMs: now };
    await this.ctx.storage.put(FAILURES_KEY, window);
    if (window.count > FAILURE_THRESHOLD) {
      const all = await this.ctx.storage.list<PairingRecord>({ prefix: KEY_PREFIX });
      if (all.size > 0) await this.ctx.storage.delete([...all.keys()]);
    }
  }

  private async ensureAlarm(): Promise<void> {
    const next = await this.ctx.storage.getAlarm();
    if (next == null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const all = await this.ctx.storage.list<PairingRecord>({ prefix: KEY_PREFIX });
    const expired: string[] = [];
    for (const [key, record] of all) {
      if (record.expiresAt < now) expired.push(key);
    }
    if (expired.length > 0) {
      await this.ctx.storage.delete(expired);
    }
    // Keep sweeping while entries remain.
    if (all.size - expired.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
