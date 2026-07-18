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

import { computeInsights } from "./insights";

describe("computeInsights", () => {
  const NOW = new Date(Date.UTC(2026, 6, 18));
  const mk = (kind: "income" | "expense", amount: number, category = "Other", daysAgo = 3): LedgerEntry => ({
    id: Math.random().toString(36).slice(2),
    ts: NOW.getTime() - daysAgo * 86400_000,
    kind, amount, note: "", category,
  });

  it("praises an above-guideline savings rate", () => {
    const ins = computeInsights([mk("income", 4000), mk("expense", 1000, "Rent")], NOW);
    expect(ins.some((i) => i.text.includes("above the 20% guideline"))).toBe(true);
  });

  it("flags a dominant category", () => {
    const ins = computeInsights(
      [mk("income", 3000), mk("expense", 1500, "Rent"), mk("expense", 200, "Food")],
      NOW
    );
    expect(ins.some((i) => i.text.startsWith("Rent is"))).toBe(true);
  });

  it("catches the small-leak pattern", () => {
    const leaks = Array.from({ length: 6 }, () => mk("expense", 12, "Food"));
    const ins = computeInsights([mk("income", 2000), ...leaks], NOW);
    expect(ins.some((i) => i.text.includes("under $25"))).toBe(true);
  });

  it("never returns more than 4 insights and never crashes empty", () => {
    expect(computeInsights([], NOW).length).toBe(0);
    const many = [mk("income", 3000), mk("expense", 1400, "Rent"),
      ...Array.from({ length: 8 }, () => mk("expense", 10, "Fun"))];
    expect(computeInsights(many, NOW).length).toBeLessThanOrEqual(4);
  });
});

import { monthlyHistory } from "./money";

describe("monthlyHistory", () => {
  const mk2 = (kind: "income" | "expense", amount: number, y: number, m: number): LedgerEntry => ({
    id: Math.random().toString(36).slice(2), ts: Date.UTC(y, m, 10), kind, amount, note: "", category: "Other",
  });

  it("one row per active month, oldest first, with correct sums", () => {
    const rows = monthlyHistory([
      mk2("income", 4000, 2026, 6), mk2("expense", 1000, 2026, 6),   // July
      mk2("income", 4000, 2026, 7), mk2("expense", 2500, 2026, 7),   // August
    ]);
    expect(rows.map((r) => r.month)).toEqual(["2026-07", "2026-08"]);
    expect(rows[0].net).toBe(3000);
    expect(rows[1].net).toBe(1500);
  });

  it("skips empty months and caps the window", () => {
    const rows = monthlyHistory(
      Array.from({ length: 15 }, (_, i) => mk2("income", 100, 2025, i)), 12);
    expect(rows.length).toBe(12);
  });
});

import { missedPaydays, budgetStatus } from "./money";
import { parseCsv, importBankCsv, categorize } from "./csv";

describe("missedPaydays", () => {
  const DAY = 86400_000;
  it("counts biweekly paydays since the anchor", () => {
    const now = Date.UTC(2026, 6, 18);
    const anchor = now - 30 * DAY;
    expect(missedPaydays(anchor, "biweekly", now).length).toBe(2);
  });
  it("caps runaway catch-ups and rejects bad anchors", () => {
    const now = Date.UTC(2026, 6, 18);
    expect(missedPaydays(now - 400 * DAY, "weekly", now).length).toBe(8);
    expect(missedPaydays(now + DAY, "weekly", now)).toEqual([]);
    expect(missedPaydays(NaN, "weekly", now)).toEqual([]);
  });
});

describe("budgetStatus", () => {
  it("computes share and over-flag, sorted worst-first", () => {
    const s = { income: 0, expenses: 0, net: 0, savingsRate: null, byCategory: { Food: 350, Gas: 40 } };
    const rows = budgetStatus(s, { Food: 300, Gas: 100 });
    expect(rows[0].category).toBe("Food");
    expect(rows[0].over).toBe(true);
    expect(rows[1].share).toBeCloseTo(0.4);
  });
});

describe("bank CSV import", () => {
  it("parses quoted fields with commas", () => {
    expect(parseCsv('a,"b,c",d\n1,2,3')).toEqual([["a", "b,c", "d"], ["1", "2", "3"]]);
  });

  it("imports a signed-Amount bank export", () => {
    const csv = [
      "Date,Description,Amount",
      '07/03/2026,"PAYROLL ACME CORP",2384.62',
      '07/05/2026,"UBER EATS 8383",-24.50',
      '07/06/2026,"SHELL OIL 4432",-38.00',
      "bad row,,",
    ].join("\n");
    const { rows, skipped } = importBankCsv(csv);
    expect(rows.length).toBe(3);
    expect(skipped).toBe(1);
    expect(rows[0]).toMatchObject({ kind: "income", amount: 2384.62, category: "Paycheck" });
    expect(rows[1]).toMatchObject({ kind: "expense", amount: 24.5, category: "Food" });
    expect(rows[2]).toMatchObject({ kind: "expense", category: "Gas" });
  });

  it("imports Debit/Credit column banks too", () => {
    const csv = ["Posted Date,Memo,Debit,Credit", "2026-07-10,NETFLIX.COM,12.99,", "2026-07-11,DEPOSIT,,500.00"].join("\n");
    const { rows } = importBankCsv(csv);
    expect(rows[0]).toMatchObject({ kind: "expense", amount: 12.99, category: "Subscriptions" });
    expect(rows[1]).toMatchObject({ kind: "income", amount: 500 });
  });

  it("categorize rules hit the common merchants", () => {
    expect(categorize("CHIPOTLE 1234")).toBe("Food");
    expect(categorize("EZPASS NJ TOLL")).toBe("Car");
    expect(categorize("SPOTIFY USA")).toBe("Subscriptions");
    expect(categorize("MYSTERY VENDOR LLC")).toBe("Other");
  });
});
