// Client for the community API. Fails soft: any error -> null, and the UI
// simply doesn't render the community layer. The national percentile (bundled
// Fed data, computed in the browser) never depends on the network.

export type CommunityResult = {
  communityPct: number | null;
  communitySize: number;
};

export type Stats = { totalChecks: number; todayChecks: number };

const API = "/api/community";
const TIMEOUT_MS = 3500;

async function withTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function submitCheck(age: number, netWorth: number): Promise<CommunityResult | null> {
  try {
    const r = await withTimeout(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ age, netWorth }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data.communitySize !== "number") return null;
    return { communityPct: data.communityPct ?? null, communitySize: data.communitySize };
  } catch {
    return null;
  }
}

export async function fetchStats(): Promise<Stats | null> {
  try {
    const r = await withTimeout(API);
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data.totalChecks !== "number") return null;
    return data as Stats;
  } catch {
    return null;
  }
}

export type Breakdown = {
  size: number;
  ready: boolean;
  buckets?: number[];
  edges?: number[];
  median?: number | null;
};

export async function fetchBreakdown(bracketKey: string): Promise<Breakdown | null> {
  try {
    const r = await withTimeout(`${API}?bracket=${encodeURIComponent(bracketKey)}`);
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data.size !== "number") return null;
    return data as Breakdown;
  } catch {
    return null;
  }
}

/* ---------- anonymous per-user account (token in localStorage) ---------- */

const TOKEN_KEY = "wr:token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Create the anonymous account once; reuse forever. Null = backend offline. */
export async function ensureAccount(): Promise<string | null> {
  const existing = getToken();
  if (existing) return existing;
  try {
    const r = await withTimeout("/api/auth", { method: "POST" });
    if (!r.ok) return null;
    const data = await r.json();
    if (typeof data.token !== "string") return null;
    localStorage.setItem(TOKEN_KEY, data.token);
    return data.token;
  } catch {
    return null;
  }
}

export type ServerEntry = { ts: number; age: number; nw: number; pct: number };

export async function fetchMyHistory(): Promise<ServerEntry[] | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const r = await withTimeout("/api/me", { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 401) {
      localStorage.removeItem(TOKEN_KEY); // stale token — next check re-registers
      return null;
    }
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data.history) ? (data.history as ServerEntry[]) : null;
  } catch {
    return null;
  }
}

export async function appendMyHistory(age: number, netWorth: number, pct: number): Promise<boolean> {
  const token = await ensureAccount();
  if (!token) return false;
  try {
    const r = await withTimeout("/api/me", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ age, netWorth, pct }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Right-to-forget: wipe the server-side account + history, drop the token. */
export async function deleteMyData(): Promise<boolean> {
  const token = getToken();
  if (!token) return true;
  try {
    const r = await withTimeout("/api/me", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (r.ok) localStorage.removeItem(TOKEN_KEY);
    return r.ok;
  } catch {
    return false;
  }
}
