import { describe, it, expect } from "vitest";
import {
  incomeBracketForAge,
  medianSalaryForAge,
  salaryRatio,
  annualize,
  paycheckFromAnnual,
  summarizeMonth,
  runningBalance,
  savingsVerdict,
  emergencyFundTarget,
  type LedgerEntry,
} from "./money";

const E = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  ts: over.ts ?? Date.UTC(2026, 6, 15),
  kind: over.kind ?? "expense",
  amount: over.amount ?? 100,
  note: over.note ?? "",
  category: over.category ?? "Other",
});

describe("income by age", () => {
  it("routes ages to brackets", () => {
    expect(incomeBracketForAge(21).label).toBe("16–24");
    expect(incomeBracketForAge(25).label).toBe("25–34");
    expect(incomeBracketForAge(70).label).toBe("65+");
  });

  it("anchors to the verified $1,235/week overall median", () => {
    // 25-34 ratio 0.91 -> 0.91 * 1235 * 52
    expect(medianSalaryForAge(30)).toBe(Math.round(0.91 * 1235 * 52));
  });

  it("salaryRatio: earning the median = 1.0", () => {
    expect(salaryRatio(30, medianSalaryForAge(30))).toBeCloseTo(1, 5);
  });
});

describe("pay frequency", () => {
  it("biweekly = 26 checks (the one people get wrong vs semimonthly=24)", () => {
    expect(annualize(2000, "biweekly")).toBe(52_000);
    expect(annualize(2000, "semimonthly")).toBe(48_000);
  });

  it("round-trips annual <-> paycheck", () => {
    expect(paycheckFromAnnual(annualize(1500, "weekly"), "weekly")).toBeCloseTo(1500);
  });
});

describe("summarizeMonth", () => {
  const july = [
    E({ kind: "income", amount: 2000, ts: Date.UTC(2026, 6, 3) }),
    E({ kind: "income", amount: 2000, ts: Date.UTC(2026, 6, 17) }),
    E({ kind: "expense", amount: 1200, category: "Rent", ts: Date.UTC(2026, 6, 5) }),
    E({ kind: "expense", amount: 400, category: "Food", ts: Date.UTC(2026, 6, 10) }),
    E({ kind: "expense", amount: 100, category: "Food", ts: Date.UTC(2026, 6, 20) }),
    E({ kind: "expense", amount: 999, ts: Date.UTC(2026, 5, 20) }), // JUNE — must be excluded
  ];

  it("aggregates only the requested month", () => {
    const s = summarizeMonth(july, "2026-07");
    expect(s.income).toBe(4000);
    expect(s.expenses).toBe(1700);
    expect(s.net).toBe(2300);
  });

  it("savings rate = net / income", () => {
    expect(summarizeMonth(july, "2026-07").savingsRate).toBeCloseTo(2300 / 4000);
  });

  it("groups expenses by category", () => {
    const s = summarizeMonth(july, "2026-07");
    expect(s.byCategory.Rent).toBe(1200);
    expect(s.byCategory.Food).toBe(500);
  });

  it("no income -> savingsRate null, not division by zero", () => {
    const s = summarizeMonth([E({ kind: "expense", amount: 50, ts: Date.UTC(2026, 6, 1) })], "2026-07");
    expect(s.savingsRate).toBeNull();
  });
});

describe("runningBalance", () => {
  it("orders chronologically and signs correctly", () => {
    const pts = runningBalance([
      E({ kind: "expense", amount: 300, ts: 2000 }),
      E({ kind: "income", amount: 1000, ts: 1000 }),
    ]);
    expect(pts.map((p) => p.balance)).toEqual([1000, 700]);
  });
});

describe("guidance", () => {
  it("verdict tiers behave", () => {
    expect(savingsVerdict(0.35).title).toBe("Elite saver");
    expect(savingsVerdict(0.2).title).toBe("On target");
    expect(savingsVerdict(-0.1).title).toBe("Spending exceeds income");
    expect(savingsVerdict(null).title).toContain("Log a paycheck");
  });

  it("emergency fund = 3-6 months of expenses", () => {
    expect(emergencyFundTarget(2000)).toEqual({ low: 6000, high: 12000 });
  });
});
