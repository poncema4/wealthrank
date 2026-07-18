/**
 * State income tax on WAGES, all 50 states + DC. Single filer.
 * Source: Tax Foundation state individual income tax rates table (latest
 * published; fetched + persisted to data/state-tax-source-2026.md).
 * Brackets are [lower bound, rate] pairs: the rate applies to income ABOVE the
 * bound up to the next bound. Flat states = one pair. Washington taxes only
 * capital gains, so wages are 0 here. Estimates ignore state deductions,
 * exemptions, credits, and local income taxes (labeled in the UI).
 */

export type StateBrackets = [number, number][]; // [lower bound, rate]

const FLAT = (rate: number): StateBrackets => [[0, rate]];

export const STATE_TAX: Record<string, StateBrackets | null> = {
  AK: null, FL: null, NV: null, NH: null, SD: null, TN: null, TX: null, WA: null, WY: null,
  AZ: FLAT(0.025), CO: FLAT(0.044), GA: FLAT(0.0539), ID: FLAT(0.05695), IL: FLAT(0.0495),
  IN: FLAT(0.03), IA: FLAT(0.038), KY: FLAT(0.04), LA: FLAT(0.03), MI: FLAT(0.0425),
  MS: FLAT(0.044), NC: FLAT(0.0425), PA: FLAT(0.0307), UT: FLAT(0.0455),
  AL: [[0, 0.02], [500, 0.04], [3000, 0.05]],
  AR: [[0, 0.02], [4500, 0.039]],
  CA: [[0, 0.01], [10756, 0.02], [25499, 0.04], [40245, 0.06], [55866, 0.08], [70606, 0.093], [360659, 0.103], [432787, 0.113], [721314, 0.123], [1000000, 0.133]],
  CT: [[0, 0.02], [10000, 0.045], [50000, 0.055], [100000, 0.06], [200000, 0.065], [250000, 0.069], [500000, 0.0699]],
  DE: [[2000, 0.022], [5000, 0.039], [10000, 0.048], [20000, 0.052], [25000, 0.0555], [60000, 0.066]],
  HI: [[0, 0.014], [9600, 0.032], [14400, 0.055], [19200, 0.064], [24000, 0.068], [36000, 0.072], [48000, 0.076], [125000, 0.079], [175000, 0.0825], [225000, 0.09], [275000, 0.10], [325000, 0.11]],
  KS: [[0, 0.052], [23000, 0.0558]],
  ME: [[0, 0.058], [26800, 0.0675], [63450, 0.0715]],
  MD: [[0, 0.02], [1000, 0.03], [2000, 0.04], [3000, 0.0475], [100000, 0.05], [125000, 0.0525], [150000, 0.055], [250000, 0.0575]],
  MA: [[0, 0.05], [1083150, 0.09]],
  MN: [[0, 0.0535], [32570, 0.068], [106990, 0.0785], [198630, 0.0985]],
  MO: [[1313, 0.02], [2626, 0.025], [3939, 0.03], [5252, 0.035], [6565, 0.04], [7878, 0.045], [9191, 0.047]],
  MT: [[0, 0.047], [21100, 0.059]],
  NE: [[0, 0.0246], [4030, 0.0351], [24120, 0.0501], [38870, 0.052]],
  NJ: [[0, 0.014], [20000, 0.0175], [35000, 0.035], [40000, 0.05525], [75000, 0.0637], [500000, 0.0897], [1000000, 0.1075]],
  NM: [[0, 0.015], [5500, 0.032], [16500, 0.043], [33500, 0.047], [66500, 0.049], [210000, 0.059]],
  NY: [[0, 0.04], [8500, 0.045], [11700, 0.0525], [13900, 0.055], [80650, 0.06], [215400, 0.0685], [1077550, 0.0965], [5000000, 0.103], [25000000, 0.109]],
  ND: [[48475, 0.0195], [244825, 0.025]],
  OH: [[26050, 0.0275], [100000, 0.035]],
  OK: [[0, 0.0025], [1000, 0.0075], [2500, 0.0175], [3750, 0.0275], [4900, 0.0375], [7200, 0.0475]],
  OR: [[0, 0.0475], [4400, 0.0675], [11050, 0.0875], [125000, 0.099]],
  RI: [[0, 0.0375], [79900, 0.0475], [181650, 0.0599]],
  SC: [[0, 0], [3560, 0.03], [17830, 0.062]],
  VT: [[0, 0.0335], [47900, 0.066], [116000, 0.076], [242000, 0.0875]],
  VA: [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]],
  WV: [[0, 0.0222], [10000, 0.0296], [25000, 0.0333], [40000, 0.0444], [60000, 0.0482]],
  WI: [[0, 0.035], [14680, 0.044], [29370, 0.053], [323290, 0.0765]],
  DC: [[0, 0.04], [10000, 0.06], [40000, 0.065], [60000, 0.085], [250000, 0.0925], [500000, 0.0975], [1000000, 0.1075]],
};

/** Tax on wages for a state code. Lower-bound bracket walk. */
export function stateTaxOnWages(code: string, income: number): number {
  const brackets = STATE_TAX[code];
  if (!brackets || income <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const [lo, rate] = brackets[i];
    const hi = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
    if (income <= lo) break;
    tax += (Math.min(income, hi) - lo) * rate;
  }
  return tax;
}
