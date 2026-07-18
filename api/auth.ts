// WealthRank auth: anonymous accounts + optional claim/login for multi-device.
//
//   POST /api/auth {}                                      -> create anonymous account { userId, token }
//   POST /api/auth {action:"claim", username, passphrase}  -> attach a username+passphrase to
//        the caller's EXISTING account (Bearer token required). Enables login anywhere.
//   POST /api/auth {action:"login", username, passphrase}  -> returns a FRESH token for that
//        account, so your history follows you to any device.
//
// Passphrases are never stored: PBKDF2-SHA256, 100k iterations, per-user salt.
// Usernames are public identifiers; the passphrase is the secret. There is no
// email and no reset flow (v1): losing both means starting fresh, and the UI
// says so honestly.

import { Redis } from "@upstash/redis";

function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!token || !url) throw new Error("account backend not configured");
  return new Redis({ url, token });
}

export const config = { runtime: "edge" };

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const MIN_PASS = 8;
const ITERATIONS = 100_000;

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassphrase(passphrase: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    keyMaterial,
    256
  );
  return hex(bits);
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish comparison (both are fixed-length hex of equal size). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const redis = makeRedis();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rlKey = `wr:rl:auth:${ip}`;
    const hits = await redis.incr(rlKey);
    if (hits === 1) await redis.expire(rlKey, 3600);
    if (hits > 30) return json({ error: "slow down" }, 429);

    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      username?: string;
      passphrase?: string;
    };
    const action = body.action ?? "register";

    /* ---------- anonymous account (the default first-touch path) ---------- */
    if (action === "register") {
      const userId = crypto.randomUUID();
      const token = newToken();
      await redis.set(`wr:tok:${token}`, userId);
      await redis.hset(`wr:user:${userId}`, { createdAt: Date.now() });
      return json({ userId, token });
    }

    const username = String(body.username ?? "").trim().toLowerCase();
    const passphrase = String(body.passphrase ?? "");
    if (!USERNAME_RE.test(username))
      return json({ error: "username must be 3-20 chars: a-z, 0-9, underscore" }, 400);
    if (passphrase.length < MIN_PASS)
      return json({ error: `passphrase must be at least ${MIN_PASS} characters` }, 400);

    /* ---------- claim: bind username+passphrase to the CALLER's account ---------- */
    if (action === "claim") {
      const auth = req.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const userId = token.length >= 32 ? await redis.get<string>(`wr:tok:${token}`) : null;
      if (!userId) return json({ error: "unauthenticated" }, 401);

      const unameKey = `wr:uname:${username}`;
      const existing = await redis.hgetall<Record<string, string>>(unameKey);
      if (existing && existing.userId) return json({ error: "username taken" }, 409);

      const saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      const salt = Array.from(saltBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const hash = await hashPassphrase(passphrase, salt);
      await redis.hset(unameKey, { userId, salt, hash });
      await redis.hset(`wr:user:${userId}`, { username });
      return json({ ok: true, username });
    }

    /* ---------- login: fresh token for the claimed account (any device) ---------- */
    if (action === "login") {
      const rec = await redis.hgetall<Record<string, string>>(`wr:uname:${username}`);
      if (!rec || !rec.userId || !rec.salt || !rec.hash) return json({ error: "invalid credentials" }, 401);
      const candidate = await hashPassphrase(passphrase, rec.salt);
      if (!safeEqual(candidate, rec.hash)) return json({ error: "invalid credentials" }, 401);

      const token = newToken();
      await redis.set(`wr:tok:${token}`, rec.userId);
      return json({ userId: rec.userId, token, username });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: "account backend unavailable", detail: String(e).slice(0, 120) }, 503);
  }
}
