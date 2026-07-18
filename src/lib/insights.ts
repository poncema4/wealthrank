/**
 * Insights engine — the deterministic layer.
 *
 * Computes real observations from the user's ledger with plain math. This is
 * the ALWAYS-ON layer; when the server has an LLM key configured, /api/insights
 * rewrites these facts into sharper natural-language coaching. The facts never
 * come from the model — the model only phrases them. That split keeps the
 * numbers trustworthy and the AI unable to hallucinate your finances.
 */

import { summarizeMonth, TARGET_SAVINGS_RATE, type LedgerEntry } from "./money";
import { fmtMoney } from "./percentile";

export type Insight = { icon: string; text: string };

const monthISO = (d: Date) => d.toISOString().slice(0, 7);

export function computeInsights(entries: LedgerEntry[], now = new Date()): Insight[] {
  const out: Insight[] = [];
  const thisMonth = monthISO(now);
  const prev = new Date(now);
  prev.setMonth(prev.getMonth() - 1);
  const lastMonth = monthISO(prev);

  const cur = summarizeMonth(entries, thisMonth);
  const old = summarizeMonth(entries, lastMonth);

  // 1. savings rate vs the guideline
  if (cur.savingsRate !== null) {
    if (cur.savingsRate >= TARGET_SAVINGS_RATE) {
      out.push({
        icon: "▲",
        text: `You're keeping ${Math.round(cur.savingsRate * 100)}% of your income this month — above the 20% guideline. That surplus is exactly what the Learn tab's compounding math feeds on.`,
      });
    } else if (cur.savingsRate >= 0) {
      const gap = Math.round((TARGET_SAVINGS_RATE - cur.savingsRate) * cur.income);
      out.push({
        icon: "◆",
        text: `Your savings rate is ${Math.round(cur.savingsRate * 100)}% — about ${fmtMoney(gap)} short of the 20% guideline this month.`,
      });
    } else {
      out.push({
        icon: "▼",
        text: `You've spent ${fmtMoney(-cur.net)} more than you earned this month. Seeing it is step one — the ledger below shows exactly where.`,
      });
    }
  }

  // 2. dominant expense category
  const cats = Object.entries(cur.byCategory).sort((a, b) => b[1] - a[1]);
  if (cats.length > 0 && cur.expenses > 0) {
    const [name, amt] = cats[0];
    const share = amt / cur.expenses;
    if (share >= 0.4) {
      out.push({
        icon: "●",
        text: `${name} is ${Math.round(share * 100)}% of this month's spending (${fmtMoney(amt)}). One category owning that much is where a budget either lives or dies.`,
      });
    }
  }

  // 3. month-over-month movement (needs a prior month)
  if (old.expenses > 0 && cur.expenses > 0) {
    const delta = (cur.expenses - old.expenses) / old.expenses;
    if (Math.abs(delta) >= 0.15) {
      out.push({
        icon: delta > 0 ? "▲" : "▼",
        text:
          delta > 0
            ? `Spending is up ${Math.round(delta * 100)}% vs last month (${fmtMoney(cur.expenses)} vs ${fmtMoney(old.expenses)}).`
            : `Spending is down ${Math.round(-delta * 100)}% vs last month — ${fmtMoney(old.expenses - cur.expenses)} kept.`,
      });
    }
  }

  // 4. small-leak detector: many small expenses adding up
  const small = entries.filter(
    (e) => e.kind === "expense" && e.amount < 25 && monthISO(new Date(e.ts)) === thisMonth
  );
  if (small.length >= 5) {
    const total = small.reduce((s, e) => s + e.amount, 0);
    out.push({
      icon: "◇",
      text: `${small.length} purchases under $25 add up to ${fmtMoney(total)} this month — the classic invisible leak.`,
    });
  }

  // 5. runway: how long current pace lasts on zero income
  if (cur.expenses > 0 && cur.income > 0 && cur.net > 0) {
    const monthsPer = Math.ceil(cur.expenses / cur.net);
    out.push({
      icon: "■",
      text:
        monthsPer <= 1
          ? `At this month's pace you bank ${fmtMoney(cur.net)}/month — every month saved buys you a full month of runway.`
          : `At this month's pace you bank ${fmtMoney(cur.net)}/month. Every ${monthsPer} months of saving buys you one full month of runway.`,
    });
  }

  return out.slice(0, 4);
}
