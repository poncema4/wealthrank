# WealthRank test results

Last full run: 2026-07-18. Unit tests: `npm test` (Vitest, src/lib/*.test.ts).

## Unit tests: 57 passing

- percentile engine (20): median->p50 pinned per Fed bracket, monotonicity, inverse
  round-trips, zero/negative floor, age-bracket routing, compound math, projections
- money engine (12): pay frequencies (biweekly 26 vs semimonthly 24), month summaries,
  savings verdicts, emergency fund, monthly history rows
- insights engine (4): savings-rate praise/flag, dominant category, small-leak detector,
  cap + empty safety
- benchmarks (3): CEX share comparisons, BEA savings-vs-nation verdict tiers
- CSV import (4): quoted-field parsing, signed-Amount banks, Debit/Credit banks,
  merchant categorization rules
- recurring + budgets (2): missed-payday math, budget status/over-flags
- tax engine (12): federal 2026 bracket walk vs hand computation, FICA, standard
  deduction floor; all-50-states: no-tax states zero, flat states exact (PA/IL/CO),
  progressive walks hand-verified (VA/NY/OH/CA), unknown-code safety

## Browser end-to-end verification (Playwright, real Chromium, 2026-07-18)

Desktop 1280px and mobile 390px, production build:

- All pages render: /, /money, /learn; top nav; URL routing + back button
- ZERO overflowing elements at both widths, every tab (measured programmatically)
- Percentile check: input -> animated result -> chart -> projections -> share
- Net worth builder computes live and fills the input
- Quick-add expense appends exactly one ledger entry per click (idempotence guard)
- RECEIPT pipeline with a real image: camera/file -> JPEG thumbnail preview ->
  clear-X works -> attach to expense -> thumbnail in ledger row -> remove receipt
  keeps the entry. Fallback decoder covers browsers where createImageBitmap fails;
  every outcome shows a visible message (no silent failures).
- BANK CSV import through the real file chooser: 5-row realistic bank file ->
  "Imported 5 transactions, auto-categorized." -> PAYROLL=income/Paycheck,
  UBER EATS=Food, SHELL=Gas, NETFLIX=Subscriptions, CHIPOTLE=Food; month stats
  recompute live
- Take-home card: $62K + New Jersey -> federal/FICA/state breakdown, per-period
  net amounts, math matches hand computation
- Sign-in modal opens/closes; account button on every page

## Live production verification (wealthrank-ai.vercel.app)

- auth: anonymous account 200, claim 200, second-device login 200 and sees the
  first device's ledger; wrong password 401; duplicate username 409
- middleware: no token 401, forged 64-char token 401 on /api/me and /api/ledger
- per-user privacy: two live accounts each saw ONLY their own rows
- ledger CRUD + profile PUT (salary, payFreq, payAnchor, budgets) all 200
- /api/og 200 image/png (generic + personalized), manifest + icon 200
- /api/insights 503 without a model key (clean degradation to local layers)
- deployed bundle hash == locally tested build at every ship
