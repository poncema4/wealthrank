/**
 * Take-home pay estimator. Single filer, standard deduction, W-2 wages.
 * Federal: 2025 brackets + $15,000 standard deduction (latest fully-verified
 * set; 2026's inflation adjustments land late 2026 and are a constants update).
 * FICA: 6.2% Social Security (to the $176,100 wage base) + 1.45% Medicare.
 * State: exact brackets for New Jersey; the nine no-income-tax states; a
 * custom effective-rate input for everywhere else. Labeled an ESTIMATE in the
 * UI: no 401k/health deductions, no local taxes, no credits.
 */

export const TAX_VINTAGE = "2025 federal brackets, single filer, standard deduction";

const STD_DEDUCTION = 15_000;
const SS_WAGE_BASE = 176_100;

const FEDERAL: [number, number][] = [
  // [top of bracket, rate]
  [11_925, 0.10],
  [48_475, 0.12],
  [103_350, 0.22],
  [197_300, 0.24],
  [250_525, 0.32],
  [626_350, 0.35],
  [Infinity, 0.37],
];

const NJ: [number, number][] = [
  [20_000, 0.014],
  [35_000, 0.0175],
  [40_000, 0.035],
  [75_000, 0.05525],
  [500_000, 0.0637],
  [1_000_000, 0.0897],
  [Infinity, 0.1075],
];

function bracketTax(taxable: number, brackets: [number, number][]): number {
  let tax = 0, prev = 0;
  for (const [top, rate] of brackets) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, top) - prev) * rate;
    prev = top;
  }
  return tax;
}

export const NO_TAX_STATES = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];

export type StateChoice = "none" | "NJ" | "custom";

export type TakeHome = {
  gross: number;
  federal: number;
  fica: number;
  state: number;
  net: number;
  effectiveRate: number; // total tax / gross
};

export function takeHome(salary: number, state: StateChoice, customRate = 0): TakeHome {
  const gross = Math.max(salary, 0);
  const taxable = Math.max(gross - STD_DEDUCTION, 0);
  const federal = bracketTax(taxable, FEDERAL);
  const fica = Math.min(gross, SS_WAGE_BASE) * 0.062 + gross * 0.0145;
  const stateTax =
    state === "NJ" ? bracketTax(gross, NJ)
    : state === "custom" ? gross * Math.min(Math.max(customRate, 0), 0.15)
    : 0;
  const net = gross - federal - fica - stateTax;
  return { gross, federal, fica, state: stateTax, net, effectiveRate: gross > 0 ? (federal + fica + stateTax) / gross : 0 };
}

/* ---------- all-state picker support ---------- */

export const ALL_STATES: [string, string][] = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],
  ["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],
  ["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],
  ["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],
  ["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],
  ["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],
  ["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],
  ["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],
  ["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],
];

/** Route a picked state to the right computation mode. Exact math where we
 * have verified brackets (NJ) or a legal zero (the nine no-tax states);
 * user-supplied rate everywhere else, with a link to look it up. */
export function choiceForState(code: string): StateChoice {
  if (code === "NJ") return "NJ";
  if (NO_TAX_STATES.includes(code)) return "none";
  return "custom";
}

export const STATE_RATE_LOOKUP_URL = "https://taxfoundation.org/data/all/state/state-income-tax-rates/";
