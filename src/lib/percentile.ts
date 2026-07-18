/**
 * WealthRank percentile engine.
 *
 * DATA SOURCE — Federal Reserve Survey of Consumer Finances (SCF), 2022 wave
 * (published late 2023). As of July 2026 this is the LATEST official release;
 * the 2025 SCF publishes ~October 2026 — when it lands, update ONLY the
 * `BRACKETS` table below and bump DATA_VINTAGE. Figures cross-checked against
 * NerdWallet / Fidelity / Kiplinger summaries of the same Fed tables.
 *
 * METHOD — the Fed publishes median + mean per age bracket, not the full
 * distribution. Net-worth distributions are heavily right-skewed, so we fit a
 * lognormal per bracket:  mu = ln(median),  sigma = sqrt(2 * ln(mean/median))
 * (from mean = exp(mu + sigma^2/2)). Percentile = normal CDF of
 * (ln(x) - mu) / sigma. This is an ESTIMATE of the curve between published
 * points — honest for "roughly where do I stand?", not audit-grade.
 * Values <= 0 (debt exceeds assets — real for ~1 in 10 young households) can't
 * go through a lognormal; we floor them at the 5th percentile.
 */

export const DATA_VINTAGE = "2022 SCF (latest official as of Jul 2026)";

export type Bracket = {
  key: string;
  label: string;
  minAge: number;
  maxAge: number; // inclusive
  median: number;
  mean: number;
};

export const BRACKETS: Bracket[] = [
  { key: "u35", label: "Under 35", minAge: 18, maxAge: 34, median: 39_000, mean: 183_500 },
  { key: "35_44", label: "35–44", minAge: 35, maxAge: 44, median: 135_000, mean: 549_600 },
  { key: "45_54", label: "45–54", minAge: 45, maxAge: 54, median: 247_000, mean: 975_800 },
  { key: "55_64", label: "55–64", minAge: 55, maxAge: 64, median: 364_000, mean: 1_566_900 },
  { key: "65_74", label: "65–74", minAge: 65, maxAge: 74, median: 410_000, mean: 1_794_600 },
  { key: "75p", label: "75+", minAge: 75, maxAge: 120, median: 335_000, mean: 1_624_100 },
];

export const MIN_AGE = 18;
export const MAX_AGE = 100;
const FLOOR_PCT = 5; // percentile assigned to zero/negative net worth
const CEIL_PCT = 99.5; // never claim someone beat literally everyone

export function bracketForAge(age: number): Bracket {
  const a = Math.min(Math.max(Math.floor(age), MIN_AGE), MAX_AGE);
  const b = BRACKETS.find((br) => a >= br.minAge && a <= br.maxAge);
  return b ?? BRACKETS[BRACKETS.length - 1];
}

/** Abramowitz–Stegun 7.1.26 erf approximation — max error ~1.5e-7, plenty here. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function sigmaFor(b: Bracket): number {
  return Math.sqrt(2 * Math.log(b.mean / b.median));
}

/** Percentile (0–100) of `netWorth` within the age's national bracket. */
export function percentileFor(age: number, netWorth: number): number {
  const b = bracketForAge(age);
  if (netWorth <= 0) return FLOOR_PCT;
  const mu = Math.log(b.median);
  const sigma = sigmaFor(b);
  const z = (Math.log(netWorth) - mu) / sigma;
  const pct = normalCdf(z) * 100;
  return Math.min(Math.max(pct, FLOOR_PCT * 0.2), CEIL_PCT);
}

/** The net worth needed to hit a given percentile in an age bracket (inverse). */
export function netWorthAtPercentile(age: number, pct: number): number {
  const p = Math.min(Math.max(pct, 0.5), 99.5) / 100;
  // inverse normal CDF via Acklam's rational approximation (sufficient accuracy)
  const q = p - 0.5;
  let z: number;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    z =
      (q *
        (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
          45921.953931549871457) *
          r +
          13731.693765509461125) *
          r +
          1971.5909503065514427) *
          r +
          133.14166789178437745) *
          r +
          3.387132872796366608)) /
      (((((((5226.495278852545703 * r + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
        1);
  } else {
    let r = p < 0.5 ? p : 1 - p;
    r = Math.sqrt(-Math.log(r));
    if (r <= 5) {
      r -= 1.6;
      z =
        (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) *
          r +
          1.27045825245236838258) *
          r +
          3.64784832476320460504) *
          r +
          5.7694972214606914055) *
          r +
          4.6303378461565452959) *
          r +
          1.42343711074968357734);
    } else {
      r -= 5;
      z =
        (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r +
          0.0012426609473880784386) *
          r +
          0.026532189526576123093) *
          r +
          0.29656057182850489123) *
          r +
          1.7848265399172913358) *
          r +
          5.4637849111641143699) *
          r +
          6.6579046435011037772);
    }
    if (p < 0.5) z = -z;
  }
  const b2 = bracketForAge(age);
  return Math.exp(Math.log(b2.median) + sigmaFor(b2) * z);
}

/** Future value: lump today + monthly contributions, annual return r, n years. */
export function futureValue(current: number, monthly: number, annualReturn: number, years: number): number {
  const r = annualReturn;
  const lump = Math.max(current, 0) * Math.pow(1 + r, years);
  // monthly contributions compounded annually (approximation: contribute 12*monthly/yr)
  const yearly = monthly * 12;
  const contrib = r === 0 ? yearly * years : yearly * ((Math.pow(1 + r, years) - 1) / r);
  return lump + contrib;
}

export type Projection = {
  years: number;
  ageThen: number;
  value: number;
  pctThen: number; // percentile among the bracket they'll be in THEN
};

export function projections(age: number, netWorth: number, monthly: number, annualReturn = 0.07): Projection[] {
  return [5, 10, 20]
    .filter((y) => age + y <= MAX_AGE)
    .map((years) => {
      const ageThen = age + years;
      const value = futureValue(netWorth, monthly, annualReturn, years);
      return { years, ageThen, value, pctThen: percentileFor(ageThen, value) };
    });
}

export function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/* ---------- distribution curve (for the SVG chart) ---------- */

export type CurvePoint = { x: number; density: number };

/**
 * Sample the fitted lognormal density across the visible range (p1..p99 of the
 * bracket) — log-spaced so the skewed curve reads correctly. Heights are
 * normalized to max=1 for direct SVG scaling.
 */
export function curveFor(age: number, samples = 60): CurvePoint[] {
  const b = bracketForAge(age);
  const mu = Math.log(b.median);
  const sigma = Math.sqrt(2 * Math.log(b.mean / b.median));
  const lnMin = mu - 2.33 * sigma; // ~p1
  const lnMax = mu + 2.33 * sigma; // ~p99
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= samples; i++) {
    const lnX = lnMin + ((lnMax - lnMin) * i) / samples;
    const x = Math.exp(lnX);
    // lognormal pdf (unnormalized constant dropped — we scale to max anyway)
    const z = (lnX - mu) / sigma;
    const density = Math.exp(-0.5 * z * z) / x;
    pts.push({ x, density });
  }
  const max = Math.max(...pts.map((p) => p.density));
  return pts.map((p) => ({ x: p.x, density: p.density / max }));
}

/* ---------- goal solver ---------- */

export type GoalPlan = {
  targetPct: number;
  targetAge: number;
  targetValue: number;
  monthlyNeeded: number; // 0 = already on track
  achievable: boolean; // false when even $5k/mo doesn't get there
};

/**
 * Monthly investment needed for `age`-year-old with `current` net worth to reach
 * the `targetPct` percentile of the bracket they'll occupy at `targetAge`.
 * Closed form: FV = lump·(1+r)^y + 12m·((1+r)^y − 1)/r  →  solve for m.
 */
export function monthlyForGoal(
  age: number,
  current: number,
  targetPct: number,
  targetAge: number,
  annualReturn = 0.07
): GoalPlan {
  const years = Math.max(targetAge - age, 1);
  const targetValue = netWorthAtPercentile(targetAge, targetPct);
  const lump = Math.max(current, 0) * Math.pow(1 + annualReturn, years);
  const annuity = (12 * (Math.pow(1 + annualReturn, years) - 1)) / annualReturn;
  const monthlyNeeded = Math.max((targetValue - lump) / annuity, 0);
  return {
    targetPct,
    targetAge,
    targetValue,
    monthlyNeeded,
    achievable: monthlyNeeded <= 5000,
  };
}
