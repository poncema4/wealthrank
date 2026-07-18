/**
 * National spending & saving benchmarks. VERIFIED figures only:
 * - BEA personal saving rate: 3.0% (May 2026 release). Updated monthly.
 * - BLS Consumer Expenditure Survey 2024 (published 2025): national average
 *   category shares of total spending: housing 33.4%, transportation 17.0%,
 *   food 12.9%.
 * Comparisons are SHARE-based (percent of your spending vs percent of the
 * average household's), which is meaningful at any income level and requires
 * no unverified per-age dollar figures.
 */

import type { MonthSummary } from "./money";

export const SAVING_RATE_VINTAGE = "BEA, May 2026";
export const NATIONAL_SAVING_RATE = 0.03;

export const CEX_VINTAGE = "BLS Consumer Expenditure Survey 2024";

// our ledger categories -> national CEX category shares of total spending
const CEX_GROUPS: { label: string; ourCategories: string[]; nationalShare: number }[] = [
  { label: "Housing", ourCategories: ["Rent"], nationalShare: 0.334 },
  { label: "Transportation", ourCategories: ["Gas", "Car"], nationalShare: 0.17 },
  { label: "Food", ourCategories: ["Food"], nationalShare: 0.129 },
];

export type ShareCompare = {
  label: string;
  yourShare: number; // 0..1 of your monthly spending
  nationalShare: number;
  delta: number; // yourShare - nationalShare
};

export function compareShares(summary: MonthSummary): ShareCompare[] {
  if (summary.expenses <= 0) return [];
  return CEX_GROUPS.map((g) => {
    const spent = g.ourCategories.reduce((s, c) => s + (summary.byCategory[c] ?? 0), 0);
    const yourShare = spent / summary.expenses;
    return { label: g.label, yourShare, nationalShare: g.nationalShare, delta: yourShare - g.nationalShare };
  }).filter((r) => r.yourShare > 0);
}

/** Your savings rate vs the national average, as a plain-language verdict. */
export function savingsVsNation(rate: number | null): string | null {
  if (rate === null) return null;
  const natl = Math.round(NATIONAL_SAVING_RATE * 100);
  const yours = Math.round(rate * 100);
  if (rate >= NATIONAL_SAVING_RATE * 2)
    return `Your ${yours}% savings rate is more than double the national average of ${natl}% (${SAVING_RATE_VINTAGE}).`;
  if (rate >= NATIONAL_SAVING_RATE)
    return `Your ${yours}% savings rate beats the national average of ${natl}% (${SAVING_RATE_VINTAGE}).`;
  if (rate >= 0)
    return `Your ${yours}% savings rate is below the national average of ${natl}% (${SAVING_RATE_VINTAGE}).`;
  return `You spent more than you earned this month; the national average saving rate is ${natl}% (${SAVING_RATE_VINTAGE}).`;
}
