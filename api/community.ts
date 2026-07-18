// WealthRank community API — Vercel Edge Function over Upstash Redis.
//
// The national percentile (Fed SCF data) is computed CLIENT-side from the bundled
// dataset — no server needed. This endpoint adds the second, live layer: how you
// rank against everyone who has actually used WealthRank.
//
// Storage per age bracket: one sorted set  wr:<bracket>  score = net worth,
// member = random anon id. Percentile = rank of your value / community size.
// Plus counters: wr:checks (all-time), wr:checks:<yyyy-mm-dd> (daily).
//
// PRIVACY, stated plainly: we store ONLY (age bracket, net worth number) under a
// random id. No names, no IPs in the dataset, nothing to identify anyone.
// Rate limiting uses the IP but only in a transient counter key.
//
// Degradation: if Redis env vars are absent this returns 503 and the frontend
// simply hides the community section — the national percentile always works.

import { Redis } from "@upstash/redis";

const RATE_MAX = 20; // submissions per IP per minute
const NW_MIN = -10_000_000; // clamp: student debt exists; sovereign wealth funds don't use this app
const NW_MAX = 100_000_000;

function bracketKeyForAge(age: number): string {
  if (age < 35) return "u35";
  if (age < 45) return "35_44";
  if (age < 55) return "45_54";
  if (age < 65) return "55_64";
  if (age < 75) return "65_74";
  return "75p";
}

function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) {
    throw new Error("community backend not configured: set UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_URL/_TOKEN)");
  }
  return new Redis({ url, token });
}

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  try {
    const redis = makeRedis();
    const today = new Date().toISOString().slice(0, 10);

    if (req.method === "GET") {
      const url = new URL(req.url);
      const bracket = url.searchParams.get("bracket");

      // GET ?bracket=u35 -> community distribution for one age bracket:
      // fixed-bucket histogram + median + size, all from the sorted set.
      if (bracket && /^(u35|35_44|45_54|55_64|65_74|75p)$/.test(bracket)) {
        const zkey = `wr:${bracket}`;
        const size = await redis.zcard(zkey);
        if (size < 20) return json({ size, ready: false }); // too few to be meaningful
        const EDGES = [0, 10_000, 50_000, 150_000, 500_000, 1_500_000];
        const counts = await Promise.all([
          redis.zcount(zkey, "-inf", "(0"),
          ...EDGES.slice(0, -1).map((lo, i) => redis.zcount(zkey, lo, `(${EDGES[i + 1]}`)),
          redis.zcount(zkey, EDGES[EDGES.length - 1], "+inf"),
        ]);
        const mid = (await redis.zrange(zkey, Math.floor(size / 2), Math.floor(size / 2), {
          withScores: true,
        })) as (string | number)[];
        const median = mid.length >= 2 ? Number(mid[1]) : null;
        return json({ size, ready: true, buckets: counts, edges: EDGES, median });
      }

      const [total, todayCount] = await Promise.all([
        redis.get<number>("wr:checks"),
        redis.get<number>(`wr:checks:${today}`),
      ]);
      return json({ totalChecks: total ?? 0, todayChecks: todayCount ?? 0 });
    }

    if (req.method === "POST") {
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "unknown";
      const rlKey = `wr:rl:${ip}`;
      const hits = await redis.incr(rlKey);
      if (hits === 1) await redis.expire(rlKey, 60);
      if (hits > RATE_MAX) return json({ error: "slow down" }, 429);

      const body = (await req.json().catch(() => ({}))) as { age?: number; netWorth?: number };
      const age = Math.floor(Number(body.age));
      const netWorth = Math.round(Number(body.netWorth));

      if (!Number.isFinite(age) || age < 18 || age > 100) return json({ error: "bad age" }, 400);
      if (!Number.isFinite(netWorth)) return json({ error: "bad net worth" }, 400);
      const clamped = Math.min(Math.max(netWorth, NW_MIN), NW_MAX);

      const bracket = bracketKeyForAge(age);
      const zkey = `wr:${bracket}`;
      const member = crypto.randomUUID();

      await redis.zadd(zkey, { score: clamped, member });

      // community percentile = share of submissions in this bracket at or below you
      const [below, size] = await Promise.all([
        redis.zcount(zkey, "-inf", clamped),
        redis.zcard(zkey),
      ]);
      const pipeline = redis.pipeline();
      pipeline.incr("wr:checks");
      pipeline.incr(`wr:checks:${today}`);
      pipeline.expire(`wr:checks:${today}`, 60 * 60 * 48);
      await pipeline.exec();

      const communityPct = size > 0 ? Math.min((below / size) * 100, 99.5) : null;
      return json({ ok: true, communityPct, communitySize: size, bracket });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    // never break the page — the frontend falls back to national-only mode
    return json({ error: "community unavailable", detail: String(e).slice(0, 120) }, 503);
  }
}
