/**
 * Take-home pay estimator. Single filer, standard deduction, W-2 wages.
 * Federal: TAX YEAR 2026 brackets + $16,100 standard deduction (IRS Rev. Proc.
 * 2025-32, verified via Tax Foundation). SS wage base $184,500 (2026).
 * FICA: 6.2% Social Security (to the $176,100 wage base) + 1.45% Medicare.
 * State: exact brackets for New Jersey; the nine no-income-tax states; a
 * custom effective-rate input for everywhere else. Labeled an ESTIMATE in the
 * UI: no 401k/health deductions, no local taxes, no credits.
 */

export const TAX_VINTAGE = "Tax year 2026 (IRS Rev. Proc. 2025-32), single filer, standard deduction";

const STD_DEDUCTION = 16_100;
const SS_WAGE_BASE = 184_500;

const FEDERAL: [number, number][] = [
  // [top of bracket, rate] — tax year 2026, verified vs Tax Foundation table
  [12_400, 0.10],
  [50_400, 0.12],
  [105_700, 0.22],
  [201_775, 0.24],
  [256_225, 0.32],
  [640_600, 0.35],
  [Infinity, 0.37],
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

import { stateTaxOnWages, STATE_TAX } from "./stateTax";

export type StateChoice = "none" | "NJ" | "custom";

export type TakeHome = {
  gross: number;
  federal: number;
  fica: number;
  state: number;
  net: number;
  effectiveRate: number; // total tax / gross
};

/** Exact take-home for any US state code (all 50 + DC have real tables). */
export function takeHomeByState(salary: number, stateCode: string): TakeHome {
  const gross = Math.max(salary, 0);
  const taxable = Math.max(gross - STD_DEDUCTION, 0);
  const federal = bracketTax(taxable, FEDERAL);
  const fica = Math.min(gross, SS_WAGE_BASE) * 0.062 + gross * 0.0145;
  const stateTax = stateCode in STATE_TAX ? stateTaxOnWages(stateCode, gross) : 0;
  const net = gross - federal - fica - stateTax;
  return { gross, federal, fica, state: stateTax, net, effectiveRate: gross > 0 ? (federal + fica + stateTax) / gross : 0 };
}

/** Legacy signature kept for compatibility; prefer takeHomeByState. */
export function takeHome(salary: number, state: StateChoice, customRate = 0): TakeHome {
  if (state === "NJ") return takeHomeByState(salary, "NJ");
  const gross = Math.max(salary, 0);
  const taxable = Math.max(gross - STD_DEDUCTION, 0);
  const federal = bracketTax(taxable, FEDERAL);
  const fica = Math.min(gross, SS_WAGE_BASE) * 0.062 + gross * 0.0145;
  const stateTax = state === "custom" ? gross * Math.min(Math.max(customRate, 0), 0.15) : 0;
  const net = gross - federal - fica - stateTax;
  return { gross, federal, fica, state: stateTax, net, effectiveRate: gross > 0 ? (federal + fica + stateTax) / gross : 0 };
}

/* ---------- all-state picker support ---------- */

export const ALL_STATES: [string, string][] = [
  ["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],
  ["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["DC","District of Columbia"],["FL","Florida"],["GA","Georgia"],
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

export { STATE_TAX, stateTaxOnWages } from "./stateTax";

export const STATE_RATE_LOOKUP_URL = "https://taxfoundation.org/data/all/state/state-income-tax-rates/";
