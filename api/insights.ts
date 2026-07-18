// WealthRank AI insights — the optional LLM layer.
//
// POST /api/insights  { facts: string[], context: {...} } -> { insights: string[] } | 503
//
// Architecture: the CLIENT computes the numeric facts (lib/insights.ts) from the
// user's ledger. This endpoint only REPHRASES those facts into coaching — the
// model never invents numbers, and the raw ledger never leaves the summaries.
// If OPENAI_API_KEY is not configured, returns 503 and the app shows the
// deterministic insights unchanged — the feature degrades, never breaks.
//
// The key lives ONLY in the server env. There is no path that exposes it.

export const config = { runtime: "edge" };

const MAX_FACTS = 6;

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const key = process.env.OPENAI_API_KEY ?? "";
  if (!key) return json({ error: "ai not configured" }, 503);

  try {
    // light per-IP rate limit without Redis dependency: keyless bucket via
    // cache headers isn't reliable at the edge, so keep it simple and strict
    const body = (await req.json().catch(() => ({}))) as { facts?: string[]; age?: number };
    const facts = (body.facts ?? []).slice(0, MAX_FACTS).map((f) => String(f).slice(0, 300));
    if (facts.length === 0) return json({ error: "no facts" }, 400);
    const age = Number.isFinite(Number(body.age)) ? Number(body.age) : null;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 350,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "You are a sharp, encouraging personal-finance coach inside the WealthRank app. " +
              "You are given VERIFIED numeric facts about the user's month. Rewrite them as 3-4 short, " +
              "punchy, personal insights (max 2 sentences each). NEVER invent numbers not present in the " +
              "facts. NEVER recommend specific securities. Educational tone, no emoji, no headers. " +
              "Return ONLY a JSON array of strings.",
          },
          {
            role: "user",
            content: `Facts about ${age ? `a ${age}-year-old` : "the user"}: ${JSON.stringify(facts)}`,
          },
        ],
      }),
    });
    if (!r.ok) return json({ error: "ai upstream error" }, 502);
    const data = await r.json();
    const text: string = data.choices?.[0]?.message?.content ?? "[]";
    let insights: string[];
    try {
      const parsed = JSON.parse(text.replace(/^```json?\s*|\s*```$/g, ""));
      insights = Array.isArray(parsed) ? parsed.map(String).slice(0, 4) : [];
    } catch {
      insights = [];
    }
    if (insights.length === 0) return json({ error: "unparseable" }, 502);
    return json({ insights });
  } catch (e) {
    return json({ error: "ai unavailable", detail: String(e).slice(0, 100) }, 503);
  }
}
