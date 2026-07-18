# WealthRank

**Where do you stand?** Your net worth vs. everyone your age — real Federal Reserve data,
one answer, five seconds. Anonymous, free, no signup required.

## Features

- **National percentile** — age + net worth in, your rank within your age group out.
  Computed in the browser from bundled Federal Reserve data; works with zero backend.
- **Distribution chart** — the actual wealth curve for your age group (SVG, no chart
  library), with your position and the median marked.
- **Net worth builder** — don't know your number? Four fields (cash, investments,
  property, debts) compute it live.
- **Community layer** — how you rank against real WealthRank users in your bracket,
  plus a live histogram of their distribution. Every check enriches the dataset.
- **Your future self** — compound-growth projections at 5/10/20 years with the
  percentile you'd hold in the age bracket you'll be in *then*.
- **Goal solver** — "reach the 75th percentile by 30" → the exact monthly investment
  required, solved in closed form.
- **Per-user progress** — every check saves to *your* anonymous account; your history
  and deltas are visible only to you, synced across visits, erasable in one click.
- **Share** — one tap: "I'm 21 and ahead of X% of my age group."

## Architecture

Full-stack on Vercel: frontend, edge middleware, API layer, database.

```
wealthrank/
├── src/                    FRONTEND — React 18 + TypeScript + Vite
│   ├── App.tsx               the whole UI
│   ├── app.css               dark fintech theme, mobile-first, zero UI deps
│   └── lib/
│       ├── percentile.ts      SCF dataset + lognormal engine + projections + goal solver
│       ├── percentile.test.ts 20 unit tests anchoring the math to Fed numbers
│       └── api.ts             API client + anonymous account management
├── middleware.ts           MIDDLEWARE — Vercel Edge: token auth, anti-spoof,
│                             per-user rate limiting, runs before /api/me
├── api/                    BACKEND — Vercel Edge Functions
│   ├── auth.ts               POST /api/auth — anonymous account creation (256-bit token)
│   ├── me.ts                 GET/POST/DELETE /api/me — per-user history (auth required)
│   └── community.ts          GET/POST /api/community — anonymous aggregates + histogram
└── DATABASE                Upstash Redis (serverless):
                              wr:tok:<token>   token -> user id
                              wr:user:<id>     profile hash
                              wr:hist:<id>     per-user history (capped list)
                              wr:<bracket>     community sorted sets
                              wr:checks[...]   counters
```

Note: `api/` at the repo root is Vercel's required location for serverless functions —
renaming it (e.g. to `backend/`) silently breaks every endpoint.

### Identity model

Zero-friction anonymous accounts: the first check creates a 256-bit random token
(returned once, kept in the browser). Middleware verifies it at the edge, resolves the
user id, strips any client-supplied identity header, and rate-limits per user. The API
layer independently re-verifies when middleware is absent (local dev) — defense in
depth. No email, no password, nothing personally identifying to breach. `DELETE /api/me`
erases everything.

## The data (honesty section)

- **Source:** Federal Reserve **2022 Survey of Consumer Finances** — the latest official
  wealth-by-age data in existence as of July 2026 (every "2026 net worth by age" article
  cites this same survey). The Fed's 2025 wave publishes ~October 2026; updating this app
  is a one-file change: `src/lib/percentile.ts` → `BRACKETS` + `DATA_VINTAGE`.
- **Method:** the Fed publishes median + mean per age bracket. Each bracket is fitted
  with a lognormal (`mu = ln(median)`, `sigma = sqrt(2·ln(mean/median))`); percentiles
  are read off that curve. A close, clearly-labeled estimate — not audit-grade quantiles.
- **Zero/negative net worth** (debt exceeds assets — real for roughly 1 in 10 young
  households) is floored at the 5th percentile.
- WealthRank is **educational, not financial advice**.

## Privacy

Community data: only `(age bracket, net worth)` under random ids — nothing identifying.
Per-user data: your history under an anonymous id, readable only with your token,
erasable via the in-app "Erase my data" button. IPs touch only transient rate-limit
counters.

## Run it

```bash
npm install
npm run dev        # frontend only, http://localhost:8090 (no /api — national-only mode)
npm test           # 20 unit tests on the engine
npm run build      # typecheck + production build

npx vercel dev     # full stack incl. auth/me/community (needs env vars below)
```

## Deploy (Vercel)

1. Import the repo — framework auto-detects Vite.
2. Storage → connect **Upstash Redis** (marketplace, free tier). The functions accept
   `KV_REST_API_URL/_TOKEN` or `UPSTASH_REDIS_REST_URL/_TOKEN`.
3. Deploy. The frontend works immediately; community + accounts activate with the env
   vars and degrade gracefully without them.

---

Built by [Marco Ponce](https://poncema4.vercel.app) · data: Federal Reserve SCF
