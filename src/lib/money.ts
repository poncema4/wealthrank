/**
 * WealthRank money engine; paychecks, expenses, cashflow, salary comparison.
 * Pure functions only; everything here is unit-tested.
 *
 * INCOME DATA; anchored to the VERIFIED BLS figure: median usual weekly earnings
 * of full-time workers = $1,235 in Q1 2026 (BLS Usual Weekly Earnings release,
 * 121.0M workers). The per-age SHAPE uses the stable ratios from prior BLS
 * releases (the age curve moves very slowly), scaled to that verified anchor -
 * labeled as an estimate in the UI. When Q2-2026 lands, update WEEKLY_ANCHOR
 * and (rarely) the ratios.
 */

export const INCOME_VINTAGE = "BLS Q1 2026 (overall median verified; age shape estimated)";

const WEEKLY_ANCHOR = 1235; // verified Q1 2026 overall median, $/week

// age-bracket earnings as a ratio of the overall median (stable across releases)
const AGE_RATIO: { minAge: number; maxAge: number; label: string; ratio: number }[] = [
  { minAge: 16, maxAge: 24, label: "16–24", ratio: 0.62 },
  { minAge: 25, maxAge: 34, label: "25–34", ratio: 0.91 },
  { minAge: 35, maxAge: 44, label: "35–44", ratio: 1.07 },
  { minAge: 45, maxAge: 54, label: "45–54", ratio: 1.08 },
  { minAge: 55, maxAge: 64, label: "55–64", ratio: 1.03 },
  { minAge: 65, maxAge: 120, label: "65+", ratio: 0.93 },
];

export function incomeBracketForAge(age: number) {
  const a = Math.min(Math.max(Math.floor(age), 16), 120);
  return AGE_RATIO.find((b) => a >= b.minAge && a <= b.maxAge) ?? AGE_RATIO[AGE_RATIO.length - 1];
}

/** Estimated median ANNUAL salary for an age (52 weeks × scaled weekly median). */
export function medianSalaryForAge(age: number): number {
  return Math.round(incomeBracketForAge(age).ratio * WEEKLY_ANCHOR * 52);
}

/** Your salary as a multiple of your age group's median (1.0 = exactly median). */
export function salaryRatio(age: number, annualSalary: number): number {
  return annualSalary / medianSalaryForAge(age);
}

/* ---------- pay frequency ---------- */

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PAY_PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export function annualize(perPaycheck: number, freq: PayFrequency): number {
  return perPaycheck * PAY_PERIODS_PER_YEAR[freq];
}

export function paycheckFromAnnual(annual: number, freq: PayFrequency): number {
  return annual / PAY_PERIODS_PER_YEAR[freq];
}

/* ---------- ledger ---------- */

export type LedgerKind = "income" | "expense";

export type LedgerEntry = {
  id: string;
  ts: number;
  kind: LedgerKind;
  amount: number; // always positive; kind carries the sign
  note: string;
  category: string;
};

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Food",
  "Gas",
  "Car",
  "Subscriptions",
  "Fun",
  "School",
  "Other",
] as const;

export type MonthSummary = {
  income: number;
  expenses: number;
  net: number;
  /** share of income kept, 0..1; null when no income logged */
  savingsRate: number | null;
  byCategory: Record<string, number>;
};

const monthKey = (ts: number) => new Date(ts).toISOString().slice(0, 7);

/** Summarize one calendar month (YYYY-MM) of the ledger. */
export function summarizeMonth(entries: LedgerEntry[], month: string): MonthSummary {
  let income = 0,
    expenses = 0;
  const byCategory: Record<string, number> = {};
  for (const e of entries) {
    if (monthKey(e.ts) !== month) continue;
    if (e.kind === "income") income += e.amount;
    else {
      expenses += e.amount;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
    }
  }
  const net = income - expenses;
  return {
    income,
    expenses,
    net,
    savingsRate: income > 0 ? net / income : null,
    byCategory,
  };
}

/** Running balance points for the sparkline (chronological). */
export function runningBalance(entries: LedgerEntry[]): { ts: number; balance: number }[] {
  const sorted = [...entries].sort((a, b) => a.ts - b.ts);
  let bal = 0;
  return sorted.map((e) => {
    bal += e.kind === "income" ? e.amount : -e.amount;
    return { ts: e.ts, balance: bal };
  });
}

/* ---------- guidance (educational rules of thumb, cited in UI) ---------- */

export const TARGET_SAVINGS_RATE = 0.2; // the 50/30/20 rule's savings slice

export function savingsVerdict(rate: number | null): { title: string; sub: string } {
  if (rate === null) return { title: "Log a paycheck to see your savings rate", sub: "" };
  if (rate >= 0.3) return { title: "Elite saver", sub: "You keep more of your income than almost anyone." };
  if (rate >= TARGET_SAVINGS_RATE)
    return { title: "On target", sub: "You're at or above the classic 20% guideline." };
  if (rate >= 0.1)
    return { title: "Close", sub: "Under the 20% guideline; one trimmed category usually closes this." };
  if (rate >= 0) return { title: "Thin margin", sub: "Most of your income is spoken for. Worth a category audit." };
  return { title: "Spending exceeds income", sub: "This month is negative; the first fix is visibility, which you now have." };
}

/** Emergency fund target: 3–6 months of average monthly expenses. */
export function emergencyFundTarget(avgMonthlyExpenses: number): { low: number; high: number } {
  return { low: avgMonthlyExpenses * 3, high: avgMonthlyExpenses * 6 };
}

/* ---------- month-by-month history (the trendline data) ---------- */

export type MonthRow = { month: string; label: string } & MonthSummary;

/** Every calendar month that has ledger activity, oldest first, capped at `max`. */
export function monthlyHistory(entries: LedgerEntry[], max = 12): MonthRow[] {
  const months = [...new Set(entries.map((e) => monthKey(e.ts)))].sort();
  return months.slice(-max).map((m) => {
    const d = new Date(`${m}-15T00:00:00Z`);
    return {
      month: m,
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" }),
      ...summarizeMonth(entries, m),
    };
  });
}

/* ---------- recurring paychecks (catch-up model) ---------- */

const FREQ_DAYS: Record<PayFrequency, number> = { weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30 };

/**
 * Paydays that have occurred since the anchor (exclusive) up to now, capped.
 * Semimonthly/monthly use day-count approximations, which is fine for a
 * catch-up prompt; the user confirms before anything is logged.
 */
export function missedPaydays(anchorTs: number, freq: PayFrequency, now = Date.now(), cap = 8): number[] {
  if (!Number.isFinite(anchorTs) || anchorTs <= 0 || anchorTs > now) return [];
  const step = FREQ_DAYS[freq] * 86400_000;
  const out: number[] = [];
  for (let t = anchorTs + step; t <= now && out.length < cap; t += step) out.push(t);
  return out;
}

/* ---------- category budgets ---------- */

export type Budgets = Record<string, number>; // category -> monthly cap in dollars

export type BudgetStatus = { category: string; spent: number; cap: number; share: number; over: boolean };

export function budgetStatus(summary: MonthSummary, budgets: Budgets): BudgetStatus[] {
  return Object.entries(budgets)
    .filter(([, cap]) => Number.isFinite(cap) && cap > 0)
    .map(([category, cap]) => {
      const spent = summary.byCategory[category] ?? 0;
      return { category, spent, cap, share: Math.min(spent / cap, 1.5), over: spent > cap };
    })
    .sort((a, b) => b.share - a.share);
}
