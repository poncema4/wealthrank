// WealthRank Edge Middleware — runs BEFORE /api/me on Vercel's edge network.
//
// Responsibilities (the classic middleware tier):
//   1. AUTH: resolve the Bearer token -> user id (Redis lookup) and forward it to
//      the API layer as `x-wr-user`. Unauthenticated requests are rejected here,
//      before any function invocation.
//   2. ANTI-SPOOF: strip any client-supplied `x-wr-user` header — only middleware
//      may set it.
//   3. RATE LIMIT: per-token, 60 requests/minute, enforced at the edge.
//
// The API layer (api/me.ts) also re-verifies the token itself when the header is
// absent, so local `vercel dev` and any middleware bypass still authenticate —
// defense in depth, not a single gate.

import { next } from "@vercel/edge";
import { Redis } from "@upstash/redis";

export const config = { matcher: ["/api/me", "/api/ledger"] };

function makeRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function middleware(req: Request) {
  const deny = (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { "content-type": "application/json" },
    });

  const redis = makeRedis();
  if (!redis) return deny("account backend not configured", 503);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length < 32) return deny("unauthenticated", 401);

  const userId = await redis.get<string>(`wr:tok:${token}`);
  if (!userId) return deny("invalid token", 401);

  const rlKey = `wr:rl:me:${userId}`;
  const hits = await redis.incr(rlKey);
  if (hits === 1) await redis.expire(rlKey, 60);
  if (hits > 60) return deny("slow down", 429);

  // forward the resolved identity; NEVER trust it from the client
  const headers = new Headers(req.headers);
  headers.delete("x-wr-user");
  headers.set("x-wr-user", userId);
  return next({ request: { headers } });
}
