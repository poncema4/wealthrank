// WealthRank auth — anonymous, passwordless accounts.
//
// POST /api/auth -> { userId, token }
//
// Design: zero-friction identity. The first time the app needs to save YOUR
// progress it calls this once, stores the returned token in localStorage, and
// every /api/me call authenticates with it (Bearer). No email, no password,
// nothing to breach — the token IS the account, scoped to your browser.
// Losing the token = losing the (anonymous) history; acceptable for v1 and
// honest about it in the UI.

import { Redis } from "@upstash/redis";

function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) throw new Error("account backend not configured");
  return new Redis({ url, token });
}

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const redis = makeRedis();

    // per-IP rate limit: account creation is cheap but not free
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rlKey = `wr:rl:auth:${ip}`;
    const hits = await redis.incr(rlKey);
    if (hits === 1) await redis.expire(rlKey, 3600);
    if (hits > 20) return json({ error: "slow down" }, 429);

    const userId = crypto.randomUUID();
    // 256-bit token — the credential. Only ever stored hashed-equivalent (opaque
    // random key) server-side; there is nothing else to steal.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    await redis.set(`wr:tok:${token}`, userId);
    await redis.hset(`wr:user:${userId}`, { createdAt: Date.now() });

    return json({ userId, token });
  } catch (e) {
    return json({ error: "account backend unavailable", detail: String(e).slice(0, 120) }, 503);
  }
}
