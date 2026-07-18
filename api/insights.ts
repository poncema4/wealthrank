// WealthRank AI insights — the optional LLM layer, multi-provider, free-first.
//
// POST /api/insights { facts: string[], age? } -> { insights: string[], provider } | 503
//
// Providers, tried in FREE-FIRST order based on which key is configured:
//   1. GEMINI_API_KEY  — Google AI Studio free tier (Flash), no credit card
//   2. GROQ_API_KEY    — Groq free tier (open-source models), no credit card
//   3. OPENAI_API_KEY  — paid, pennies at mini rates
//
// Architecture: the CLIENT computes verified numeric facts (lib/insights.ts).
// The model only REPHRASES them as coaching — it never invents numbers, and the
// raw ledger never leaves the summaries. No key configured -> 503 and the app
// shows the deterministic insights unchanged. Keys live ONLY in server env.

export const config = { runtime: "edge" };

const MAX_FACTS = 6;

const SYSTEM_PROMPT =
  "You are a sharp, encouraging personal-finance coach inside the WealthRank app. " +
  "You are given VERIFIED numeric facts about the user's month. Rewrite them as 3-4 short, " +
  "punchy, personal insights (max 2 sentences each). NEVER invent numbers not present in the " +
  "facts. NEVER recommend specific securities. Educational tone, no emoji, no headers. " +
  "Return ONLY a JSON array of strings.";

function parseArray(text: string): string[] {
  try {
    const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 4) : [];
  } catch {
    return [];
  }
}

async function viaGemini(key: string, userMsg: string): Promise<string[] | null> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userMsg }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
    }
  );
  if (!r.ok) return null;
  const data = await r.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const out = parseArray(text);
  return out.length ? out : null;
}

/** OpenAI-compatible chat endpoint — used by both Groq and OpenAI. */
async function viaOpenAiCompatible(
  url: string,
  key: string,
  model: string,
  userMsg: string
): Promise<string[] | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const out = parseArray(data.choices?.[0]?.message?.content ?? "");
  return out.length ? out : null;
}

export default async function handler(req: Request): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const gemini = process.env.GEMINI_API_KEY ?? "";
  const groq = process.env.GROQ_API_KEY ?? "";
  const openai = process.env.OPENAI_API_KEY ?? "";
  if (!gemini && !groq && !openai) return json({ error: "ai not configured" }, 503);

  try {
    const body = (await req.json().catch(() => ({}))) as { facts?: string[]; age?: number };
    const facts = (body.facts ?? []).slice(0, MAX_FACTS).map((f) => String(f).slice(0, 300));
    if (facts.length === 0) return json({ error: "no facts" }, 400);
    const age = Number.isFinite(Number(body.age)) ? Number(body.age) : null;
    const userMsg = `Facts about ${age ? `a ${age}-year-old` : "the user"}: ${JSON.stringify(facts)}`;

    // free-first provider chain; fall through on any failure
    if (gemini) {
      const out = await viaGemini(gemini, userMsg);
      if (out) return json({ insights: out, provider: "gemini" });
    }
    if (groq) {
      const out = await viaOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        groq,
        process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        userMsg
      );
      if (out) return json({ insights: out, provider: "groq" });
    }
    if (openai) {
      const out = await viaOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        openai,
        process.env.OPENAI_MODEL || "gpt-4o-mini",
        userMsg
      );
      if (out) return json({ insights: out, provider: "openai" });
    }
    return json({ error: "all providers failed" }, 502);
  } catch (e) {
    return json({ error: "ai unavailable", detail: String(e).slice(0, 100) }, 503);
  }
}
