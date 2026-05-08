import { DurableObject } from "cloudflare:workers";

interface PairingRecord {
  sessionDoId: string;
  expiresAt: number;
}

const SWEEP_INTERVAL_MS = 60_000;
const KEY_PREFIX = "code:";

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
    if (!record) return null;
    await this.ctx.storage.delete(key);
    if (record.expiresAt < Date.now()) return null;
    return record.sessionDoId;
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
