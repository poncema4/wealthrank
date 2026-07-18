// WealthRank per-user API — YOUR progress, visible only to you.
//
//   GET    /api/me -> { profile, history[] }   (newest last)
//   POST   /api/me { age, netWorth, pct } -> append a history entry
//   DELETE /api/me -> erase the account and all its data (right-to-forget)
//
// Identity arrives as `x-wr-user`, set by middleware.ts after verifying the
// Bearer token at the edge. Defense in depth: if the header is missing (local
// vercel dev, middleware bypass) this function verifies the token itself the
// same way. Client-supplied x-wr-user can't spoof — middleware strips it, and
// without middleware the header path is not trusted at all.
//
// Storage per user:
//   wr:user:<id>   hash   { createdAt }
//   wr:hist:<id>   list   JSON entries, capped at 200

import { Redis } from "@upstash/redis";

function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) throw new Error("account backend not configured");
  return new Redis({ url, token });
}

export const config = { runtime: "edge" };

type Entry = { ts: number; age: number; nw: number; pct: number };

async function resolveUser(req: Request, redis: Redis, viaMiddleware: boolean): Promise<string | null> {
  if (viaMiddleware) {
    const fromMw = req.headers.get("x-wr-user");
    if (fromMw) return fromMw;
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length < 32) return null;
  return (await redis.get<string>(`wr:tok:${token}`)) ?? null;
}

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  try {
    const redis = makeRedis();
    // Trust x-wr-user only when the deployment actually runs middleware (Vercel
    // sets this env in production); otherwise verify the token directly.
    const viaMiddleware = Boolean(process.env.VERCEL);
    const userId = await resolveUser(req, redis, viaMiddleware);
    if (!userId) return json({ error: "unauthenticated" }, 401);

    const histKey = `wr:hist:${userId}`;

    if (req.method === "GET") {
      const [profile, raw] = await Promise.all([
        redis.hgetall(`wr:user:${userId}`),
        redis.lrange<string>(histKey, 0, 199),
      ]);
      const history = raw
        .map((s) => {
          try {
            return typeof s === "string" ? (JSON.parse(s) as Entry) : (s as unknown as Entry);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .reverse(); // stored newest-first; serve oldest-first
      return json({ profile: profile ?? {}, history });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Partial<Entry> & { netWorth?: number };
      const age = Math.floor(Number(body.age));
      const nw = Math.round(Number(body.netWorth ?? body.nw));
      const pct = Number(body.pct);
      if (!Number.isFinite(age) || age < 18 || age > 100) return json({ error: "bad age" }, 400);
      if (!Number.isFinite(nw)) return json({ error: "bad net worth" }, 400);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return json({ error: "bad pct" }, 400);

      const entry: Entry = { ts: Date.now(), age, nw, pct };

      // idempotence: identical value within 10s = the same check double-fired
      const lastRaw = (await redis.lindex(histKey, 0)) as string | null;
      if (lastRaw) {
        try {
          const last = (typeof lastRaw === "string" ? JSON.parse(lastRaw) : lastRaw) as Entry;
          if (last.age === age && last.nw === nw && entry.ts - last.ts < 10_000) {
            return json({ ok: true, deduped: true });
          }
        } catch {
          /* unparseable head — just append */
        }
      }

      await redis.lpush(histKey, JSON.stringify(entry));
      await redis.ltrim(histKey, 0, 199);
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      // erase EVERYTHING the user owns: history, ledger, profile (right-to-forget)
      await Promise.all([redis.del(histKey), redis.del(`wr:led:${userId}`), redis.del(`wr:user:${userId}`)]);
      // the token row is deleted by the client forgetting it; sweep it too if sent
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (token) await redis.del(`wr:tok:${token}`);
      return json({ ok: true, deleted: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ error: "account backend unavailable", detail: String(e).slice(0, 120) }, 503);
  }
}
