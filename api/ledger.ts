// WealthRank ledger API — YOUR paychecks and expenses, visible only to you.
//
//   GET    /api/ledger              -> { profile, entries[] } (chronological)
//   POST   /api/ledger              -> add entry { kind, amount, note, category, ts? }
//   PUT    /api/ledger              -> save profile { salary?, payFreq? }
//   DELETE /api/ledger?id=<entryId> -> remove one entry
//
// Same identity model as /api/me: middleware verifies the Bearer token at the
// edge and forwards x-wr-user; this function re-verifies when the header is
// absent (local dev / defense in depth).
//
// Storage per user:
//   wr:led:<id>    list  JSON LedgerEntry, newest first, capped at 500
//   wr:user:<id>   hash  += { salary, payFreq }

import { Redis } from "@upstash/redis";

function makeRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
  if (!url || !token) throw new Error("ledger backend not configured");
  return new Redis({ url, token });
}

export const config = { runtime: "edge" };

type Entry = { id: string; ts: number; kind: "income" | "expense"; amount: number; note: string; category: string };

const KINDS = new Set(["income", "expense"]);
const MAX_AMOUNT = 10_000_000;
const MAX_NOTE = 80;

async function resolveUser(req: Request, redis: Redis): Promise<string | null> {
  if (process.env.VERCEL) {
    const fromMw = req.headers.get("x-wr-user");
    if (fromMw) return fromMw;
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token.length < 32) return null;
  return (await redis.get<string>(`wr:tok:${token}`)) ?? null;
}

function parseEntry(raw: unknown): Entry | null {
  try {
    const e = (typeof raw === "string" ? JSON.parse(raw) : raw) as Entry;
    return e && typeof e.id === "string" ? e : null;
  } catch {
    return null;
  }
}

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  try {
    const redis = makeRedis();
    const userId = await resolveUser(req, redis);
    if (!userId) return json({ error: "unauthenticated" }, 401);

    const ledKey = `wr:led:${userId}`;
    const userKey = `wr:user:${userId}`;

    if (req.method === "GET") {
      const [profile, raw] = await Promise.all([redis.hgetall(userKey), redis.lrange(ledKey, 0, 499)]);
      const entries = raw.map(parseEntry).filter(Boolean).reverse(); // serve oldest-first
      return json({ profile: profile ?? {}, entries });
    }

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Partial<Entry>;
      const kind = String(body.kind ?? "");
      const amount = Math.round(Number(body.amount) * 100) / 100;
      const note = String(body.note ?? "").replace(/[<>&"'`]/g, "").trim().slice(0, MAX_NOTE);
      const category = String(body.category ?? "Other").replace(/[<>&"'`]/g, "").slice(0, 24) || "Other";
      const ts = Number.isFinite(Number(body.ts)) ? Number(body.ts) : Date.now();

      if (!KINDS.has(kind)) return json({ error: "bad kind" }, 400);
      if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return json({ error: "bad amount" }, 400);

      const entry: Entry = { id: crypto.randomUUID(), ts, kind: kind as Entry["kind"], amount, note, category };
      await redis.lpush(ledKey, JSON.stringify(entry));
      await redis.ltrim(ledKey, 0, 499);
      return json({ ok: true, entry });
    }

    if (req.method === "PUT") {
      const body = (await req.json().catch(() => ({}))) as { salary?: number; payFreq?: string };
      const fields: Record<string, string | number> = {};
      if (body.salary !== undefined) {
        const s = Math.round(Number(body.salary));
        if (!Number.isFinite(s) || s < 0 || s > 50_000_000) return json({ error: "bad salary" }, 400);
        fields.salary = s;
      }
      if (body.payFreq !== undefined) {
        if (!["weekly", "biweekly", "semimonthly", "monthly"].includes(String(body.payFreq)))
          return json({ error: "bad payFreq" }, 400);
        fields.payFreq = String(body.payFreq);
      }
      if (Object.keys(fields).length) await redis.hset(userKey, fields);
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const id = new URL(req.url).searchParams.get("id") ?? "";
      if (!id) return json({ error: "missing id" }, 400);
      // find the exact stored string for LREM (list stores serialized JSON)
      const raw = await redis.lrange(ledKey, 0, 499);
      const match = raw.find((r) => parseEntry(r)?.id === id);
      if (!match) return json({ error: "not found" }, 404);
      await redis.lrem(ledKey, 1, typeof match === "string" ? match : JSON.stringify(match));
      return json({ ok: true, deleted: id });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ error: "ledger backend unavailable", detail: String(e).slice(0, 120) }, 503);
  }
}
