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

## Layer 4: Playwright e2e suite (added 2026-07-18 evening)

Runnable browser tests now live in `tests/e2e/app.spec.ts` (config: `playwright.config.ts`).
Run with `npx playwright test` — they execute against the LIVE site on two devices:
a desktop Chrome viewport and an iPhone 14 viewport. Failure artifacts land in
`tests/test-results/` (gitignored).

Latest run vs https://wealthrank-ai.vercel.app: 16 passed, 0 failed (8 tests x 2 devices).

Covered: rank percentile calc, URL routing (/money, /learn), account modal open/close
with password field, 50 states + DC in the tax dropdown (52 options), VA-vs-TX take-home
difference after Save, bank CSV import of tests/fixtures/test-bank.csv (5 rows categorized),
receipt attach success message, Learn projections, and a no-horizontal-overflow check on
every tab at phone width.

Note: this suite CAUGHT a real bug on first run — DC had a full tax table in the engine
but was missing from the dropdown, so a DC user could never select it. Fixed same day.

## iPhone receipt hardening (2026-07-18 evening)

Camera photos on iOS failed for some captures because img.decode() and createImageBitmap
both have known iOS Safari failures on large images. The decoder is now 3 paths:
createImageBitmap -> objectURL + img.onload -> FileReader dataURL + img.onload (the most
compatible path iOS has). The capture attribute was removed so iPhones offer
"Take Photo OR Photo Library" (library picks are auto-converted to JPEG by iOS).
On failure the message now names the file format and size so any report self-diagnoses.
