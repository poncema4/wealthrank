/**
 * On-device AI — Chrome's built-in Prompt API (Gemini Nano).
 *
 * Runs a small LLM locally in the browser: no API key, no server, no cost, and
 * the user's financial facts NEVER leave their device. Availability is
 * hardware- and browser-dependent (Chrome with the model downloaded), so this
 * is strictly progressive enhancement — feature-detect, try, fall back.
 *
 * The API surface has shifted across Chrome versions; we detect both shapes:
 *   new:  globalThis.LanguageModel.availability() / .create()
 *   old:  window.ai.languageModel.capabilities() / .create()
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const SYSTEM_PROMPT =
  "You are a sharp, encouraging personal-finance coach. You are given VERIFIED numeric facts " +
  "about the user's month. Rewrite them as 3-4 short, punchy, personal insights (max 2 sentences " +
  "each). NEVER invent numbers not present in the facts. NEVER recommend specific stocks. " +
  "No emoji. Return ONLY a JSON array of strings, nothing else.";

function parseArray(text: string): string[] {
  try {
    const cleaned = text.replace(/^```json?\s*|\s*```$/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 4) : [];
  } catch {
    return [];
  }
}

async function getSession(): Promise<any | null> {
  const g = globalThis as any;
  try {
    // new API shape
    if (g.LanguageModel?.availability && g.LanguageModel?.create) {
      const avail = await g.LanguageModel.availability();
      if (avail === "available" || avail === "readily") {
        return await g.LanguageModel.create({ initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }] });
      }
      return null; // "downloadable"/"downloading" — don't force a model download on users
    }
    // older API shape
    const lm = g.ai?.languageModel ?? g.window?.ai?.languageModel;
    if (lm?.capabilities && lm?.create) {
      const caps = await lm.capabilities();
      if (caps?.available === "readily") {
        return await lm.create({ systemPrompt: SYSTEM_PROMPT });
      }
    }
  } catch {
    /* any failure = not available */
  }
  return null;
}

/** True if this browser can run on-device AI right now (model already present). */
export async function localAiAvailable(): Promise<boolean> {
  const s = await getSession();
  if (s) {
    try { s.destroy?.(); } catch { /* noop */ }
    return true;
  }
  return false;
}

/** Rephrase verified facts with the on-device model. Null on any failure. */
export async function localAiInsights(facts: string[], age?: number): Promise<string[] | null> {
  const session = await getSession();
  if (!session) return null;
  try {
    const msg = `Facts about ${age ? `a ${age}-year-old` : "the user"}: ${JSON.stringify(facts.slice(0, 6))}`;
    const raw: string = await session.prompt(msg);
    const out = parseArray(raw);
    return out.length ? out : null;
  } catch {
    return null;
  } finally {
    try { session.destroy?.(); } catch { /* noop */ }
  }
}
