import { useMemo, useState } from "react";
import { futureValue, fmtMoney } from "./lib/percentile";
import {
  summarizeMonth,
  emergencyFundTarget,
  type LedgerEntry,
} from "./lib/money";

/* Personalized investing education. Everything here is math + widely-taught
   principles, computed from YOUR numbers. It deliberately never names a stock
   to buy; that's the line between education and advice. */

function readLedger(): LedgerEntry[] {
  try {
    return JSON.parse(localStorage.getItem("wr:ledger") || "[]");
  } catch {
    return [];
  }
}

const STEPS = [
  {
    t: "1. Build the emergency fund first",
    d: "Three to six months of expenses in a high-yield savings account. This is what keeps a surprise car repair from becoming credit-card debt. It comes before any investing.",
  },
  {
    t: "2. Take any employer 401(k) match",
    d: "If your job matches retirement contributions, that is an instant, guaranteed 50–100% return on the matched amount. No investment on Earth beats it. Contribute at least enough to get the full match.",
  },
  {
    t: "3. Then invest in broad index funds",
    d: "An index fund buys a tiny slice of hundreds of companies at once (an S&P 500 fund holds the 500 largest U.S. companies). One purchase = instant diversification, near-zero fees, no stock-picking. This is what most of the money in retirement accounts actually is, and what Warren Buffett recommends for almost everyone.",
  },
  {
    t: "4. Automate it and stop looking",
    d: "A fixed amount every payday, automatically. Time in the market beats timing the market; historically, missing just the 10 best days in a decade roughly halves returns. Automation removes the human error.",
  },
];

export default function Learn() {
  const entries = readLedger();
  const month = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => summarizeMonth(entries, month), [entries, month]);
  const [monthly, setMonthly] = useState(200);

  const efund = summary.expenses > 0 ? emergencyFundTarget(summary.expenses) : null;
  const horizons = [10, 20, 30];

  return (
    <div>
      <section className="card">
        <h2 className="section-title">Why invest at all; your numbers</h2>
        <p className="learn-p">
          Cash loses to inflation. The S&P 500's long-run average is ~10%/yr before inflation (~7% after) -
          not a promise, but a century of history. Watch what that difference does to
          <b> {fmtMoney(monthly)}/month</b>:
        </p>
        <input className="slider" type="range" min={50} max={2000} step={50} value={monthly}
          onChange={(e) => setMonthly(Number(e.target.value))} />
        <div className="proj-row">
          {horizons.map((y) => (
            <div className="proj" key={y}>
              <div className="proj-age">in {y} years</div>
              <div className="proj-v">{fmtMoney(futureValue(0, monthly, 0.07, y))}</div>
              <div className="proj-pct">
                vs {fmtMoney(monthly * 12 * y)} kept as cash
              </div>
            </div>
          ))}
        </div>
        <p className="footnote">
          7% = inflation-adjusted historical average of a broad U.S. index. Real results vary year to year,
          sometimes wildly. The lesson is the gap, not the exact number.
        </p>
      </section>

      <section className="card">
        <h2 className="section-title">The order of operations</h2>
        {STEPS.map((s) => (
          <div className="learn-step" key={s.t}>
            <div className="learn-step-t">{s.t}</div>
            <div className="learn-step-d">{s.d}</div>
          </div>
        ))}
        {efund && (
          <div className="salary-compare">
            Based on your logged expenses ({fmtMoney(summary.expenses)}/month), your emergency-fund
            target is <b>{fmtMoney(efund.low)}–{fmtMoney(efund.high)}</b>. Log more months for a
            better estimate.
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="section-title">Starting from zero is normal</h2>
        <p className="learn-p">
          If your investments line says $0 today, you're exactly where most people your age are; the
          Fed's own data shows the median under-35 household holds modest financial assets. What separates
          outcomes isn't starting money; it's starting <i>date</i>. Every year of delay at a 7% return
          costs roughly 7% of the final total, compounded; starting at 21 instead of 31 can nearly
          <b> double</b> the end result for the same monthly amount.
        </p>
        <p className="learn-p">
          Practical first move: open a brokerage or Roth IRA account (most are free), set up an automatic
          monthly transfer; even $50, into a broad index fund, and let the Money tab here track what
          that does to your savings rate.
        </p>
      </section>

      <p className="footnote center">
        WealthRank teaches the math; it never recommends specific securities. Not financial advice;
        for personal guidance talk to a licensed fiduciary advisor.
      </p>
    </div>
  );
}
