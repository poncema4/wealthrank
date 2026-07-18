import { useEffect, useMemo, useRef, useState } from "react";
import {
  DATA_VINTAGE,
  MIN_AGE,
  MAX_AGE,
  bracketForAge,
  percentileFor,
  netWorthAtPercentile,
  projections,
  curveFor,
  monthlyForGoal,
  fmtMoney,
} from "./lib/percentile";
import Money from "./Money";
import Account, { savedUsername } from "./Account";
import Learn from "./Learn";
import {
  submitCheck,
  fetchStats,
  fetchBreakdown,
  fetchMyHistory,
  appendMyHistory,
  deleteMyData,
  getToken,
  type CommunityResult,
  type Stats,
  type Breakdown,
  type ServerEntry,
} from "./lib/api";

/* ---------- small hooks & helpers ---------- */

function useCountUp(target: number | null, ms = 1200): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    if (target === null) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / ms, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [target, ms]);
  return value;
}

function ordinal(n: number): string {
  const i = Math.round(n);
  const s = ["th", "st", "nd", "rd"], v = i % 100;
  return i + (s[(v - 20) % 10] || s[v] || s[0]);
}

function verdict(pct: number): { title: string; sub: string } {
  if (pct >= 90) return { title: "Elite territory", sub: "You're ahead of nearly everyone your age." };
  if (pct >= 75) return { title: "Well ahead", sub: "Top quarter of your age group." };
  if (pct >= 50) return { title: "Ahead of the pack", sub: "Above the median for your age." };
  if (pct >= 30) return { title: "In the mix", sub: "Below median, but the curve is steep; small moves matter." };
  return { title: "Building mode", sub: "Most wealth at your age is built, not started with." };
}

/* ---------- local history (track your progress over time) ---------- */

type HistoryEntry = { ts: number; age: number; nw: number; pct: number };
const HISTORY_KEY = "wr:history";

function readHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function pushHistory(e: HistoryEntry): HistoryEntry[] {
  const prev = readHistory();
  const last = prev[prev.length - 1];
  // idempotent: double-taps and double-dispatched clicks must not duplicate an entry
  if (last && last.age === e.age && last.nw === e.nw && e.ts - last.ts < 3000) return prev;
  const list = [...prev, e].slice(-50);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
  return list;
}

/* ---------- distribution chart (hand-rolled SVG, no chart deps) ---------- */

function DistributionChart({ age, netWorth }: { age: number; netWorth: number }) {
  const W = 560, H = 120, PAD = 4;
  const pts = useMemo(() => curveFor(age), [age]);
  const xMin = pts[0].x, xMax = pts[pts.length - 1].x;
  const lnMin = Math.log(xMin), lnMax = Math.log(xMax);
  const toX = (x: number) => PAD + ((Math.log(Math.max(x, xMin)) - lnMin) / (lnMax - lnMin)) * (W - 2 * PAD);
  const toY = (d: number) => H - PAD - d * (H - 2 * PAD);
  const path =
    `M ${toX(pts[0].x)} ${H - PAD} ` +
    pts.map((p) => `L ${toX(p.x)} ${toY(p.density)}`).join(" ") +
    ` L ${toX(pts[pts.length - 1].x)} ${H - PAD} Z`;
  const b = bracketForAge(age);
  const youX = toX(Math.min(Math.max(netWorth, xMin), xMax));
  const medX = toX(b.median);

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label="Net worth distribution for your age group with your position marked">
        <defs>
          <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3ddc84" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#22b8cf" stopOpacity="0.06" />
          </linearGradient>
        </defs>
        <path d={path} fill="url(#curveFill)" stroke="#3ddc84" strokeWidth="1.5" />
        <line x1={medX} y1={PAD} x2={medX} y2={H - PAD} stroke="#8b98a5" strokeWidth="1" strokeDasharray="3 3" />
        <text x={medX} y={H + 16} textAnchor="middle" className="chart-label">median {fmtMoney(b.median)}</text>
        <line x1={youX} y1={PAD} x2={youX} y2={H - PAD} stroke="#fff" strokeWidth="2" />
        <circle cx={youX} cy={PAD + 4} r="4" fill="#fff" />
        <text x={youX} y={H + 16} textAnchor={youX > W - 60 ? "end" : youX < 60 ? "start" : "middle"} className="chart-label you">you</text>
      </svg>
    </div>
  );
}

/* ---------- community histogram ---------- */

function CommunityHistogram({ data, netWorth }: { data: Breakdown; netWorth: number }) {
  if (!data.ready || !data.buckets || !data.edges) return null;
  const labels = ["< $0", "$0–10K", "$10–50K", "$50–150K", "$150–500K", "$500K–1.5M", "$1.5M+"];
  const max = Math.max(...data.buckets, 1);
  const youBucket = (() => {
    if (netWorth < 0) return 0;
    const idx = data.edges.findIndex((lo, i) => netWorth >= lo && (i + 1 >= data.edges!.length || netWorth < data.edges![i + 1]));
    return idx === -1 ? labels.length - 1 : idx + 1;
  })();
  return (
    <div className="hist">
      <div className="hist-title">
        How {data.size.toLocaleString()} WealthRank users in your age group are distributed
        {data.median != null && <span> · community median {fmtMoney(data.median)}</span>}
      </div>
      <div className="hist-bars">
        {data.buckets.map((count, i) => (
          <div className="hist-col" key={i}>
            <div className="hist-bar-space">
              <div
                className={`hist-bar${i === youBucket ? " you" : ""}`}
                style={{ height: `${Math.max((count / max) * 100, count > 0 ? 4 : 0)}%` }}
                title={`${count} users`}
              />
            </div>
            <div className={`hist-label${i === youBucket ? " you" : ""}`}>{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- net worth builder ---------- */

type BuilderState = { cash: string; invest: string; property: string; debt: string };
const emptyBuilder: BuilderState = { cash: "", invest: "", property: "", debt: "" };

function num(s: string): number {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* ==================================================================== */

export default function App() {
  type Tab = "rank" | "money" | "learn";
  const tabFromPath = (): Tab => {
    const seg = window.location.pathname.replace(/^\/+|\/+$/g, "");
    return seg === "money" || seg === "learn" ? seg : "rank";
  };
  const [tab, setTabState] = useState<Tab>(tabFromPath);
  const setTab = (t: Tab) => {
    setTabState(t);
    const path = t === "rank" ? "/" : `/${t}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  };
  useEffect(() => {
    const onPop = () => setTabState(tabFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [acctOpen, setAcctOpen] = useState(false);
  const [age, setAge] = useState("");
  const [netWorth, setNetWorth] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder);
  const [result, setResult] = useState<{ age: number; nw: number; pct: number } | null>(null);
  const [community, setCommunity] = useState<CommunityResult | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [monthly, setMonthly] = useState(200);
  const [goalPct, setGoalPct] = useState(75);
  const [goalAge, setGoalAge] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(readHistory);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);

  const [serverHistory, setServerHistory] = useState<ServerEntry[] | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    fetchStats().then(setStats);
    if (getToken()) {
      fetchMyHistory().then((h) => {
        if (h) {
          setServerHistory(h);
          setSynced(true);
        }
      });
    }
  }, []);

  const displayPct = useCountUp(result?.pct ?? null);
  const builderTotal = num(builder.cash) + num(builder.invest) + num(builder.property) - num(builder.debt);

  const applyBuilder = () => {
    setNetWorth(String(builderTotal));
    setBuilderOpen(false);
  };

  const check = async () => {
    setError("");
    const a = Math.floor(Number(age));
    const nw = num(netWorth);
    if (!Number.isFinite(a) || a < MIN_AGE || a > MAX_AGE) {
      setError(`Age must be between ${MIN_AGE} and ${MAX_AGE}.`);
      return;
    }
    if (netWorth.trim() === "") {
      setError("Enter your net worth; assets minus debts. A rough estimate is fine.");
      return;
    }
    const pct = percentileFor(a, nw);
    setResult({ age: a, nw, pct });
    setGoalAge(Math.min(a + 9, MAX_AGE));
    setCommunity(null);
    setBreakdown(null);
    setHistory(pushHistory({ ts: Date.now(), age: a, nw, pct }));
    // per-user backend: append to YOUR server-side history (auto-creates the
    // anonymous account on first use; silently stays local-only if offline)
    appendMyHistory(a, nw, pct).then((ok) => {
      setSynced(ok);
      if (ok) fetchMyHistory().then((h) => h && setServerHistory(h));
    });
    const bkey = bracketForAge(a).key;
    submitCheck(a, nw).then((c) => {
      setCommunity(c);
      fetchStats().then(setStats);
      fetchBreakdown(bkey).then(setBreakdown);
    });
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const bracket = result ? bracketForAge(result.age) : null;
  const proj = useMemo(() => (result ? projections(result.age, result.nw, monthly) : []), [result, monthly]);
  const goal = useMemo(
    () => (result && goalAge ? monthlyForGoal(result.age, result.nw, goalPct, goalAge) : null),
    [result, goalPct, goalAge]
  );
  const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
  const delta = result && prevEntry ? result.nw - prevEntry.nw : null;

  const shareText = result
    ? `I'm ${result.age} and ahead of ${Math.round(result.pct)}% of my age group in net worth. Where do you stand? wealthrank-ai.vercel.app`
    : "";

  const share = async () => {
    if (!result) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
    } catch {
      /* cancelled; fall through */
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="wrap">
      <nav className="topbar">
        <div className="topbar-logo">
          Wealth<span>Rank</span>
        </div>
        <div className="topbar-links">
          <button className={tab === "rank" ? "on" : ""} onClick={() => setTab("rank")}>Rank</button>
          <button className={tab === "money" ? "on" : ""} onClick={() => setTab("money")}>Money</button>
          <button className={tab === "learn" ? "on" : ""} onClick={() => setTab("learn")}>Learn</button>
        </div>
        <button className={savedUsername() ? "acct-btn in" : "acct-btn"} onClick={() => setAcctOpen((v) => !v)}>
          {savedUsername() || "Account"}
        </button>
      </nav>

      {tab === "rank" && (
        <header className="page-head">
          <div className="kicker">Net worth · percentile vs your age group</div>
          <h1>Where do you stand?</h1>
          <p className="tagline">
            Your net worth vs. everyone your age. Real Federal Reserve data, one answer, five seconds.
            {stats && stats.totalChecks > 0 && (
              <span className="live-count"> · {stats.totalChecks.toLocaleString()} checks so far</span>
            )}
          </p>
        </header>
      )}
      {tab === "money" && (
        <header className="page-head">
          <div className="kicker">Ledger · paychecks, spending, benchmarks</div>
          <h1>Your money</h1>
          <p className="tagline">Track what comes in and goes out, and see how you compare to the country.</p>
        </header>
      )}
      {tab === "learn" && (
        <header className="page-head">
          <div className="kicker">Education · investing fundamentals, your numbers</div>
          <h1>Make it grow</h1>
          <p className="tagline">The math and the order of operations, computed from your own ledger.</p>
        </header>
      )}

      {acctOpen && <Account onClose={() => setAcctOpen(false)} />}

      {tab === "money" && <Money />}
      {tab === "learn" && <Learn />}

      {tab === "rank" && <>
      <section className="card input-card">
        <div className="fields">
          <label>
            <span>Your age</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="21"
              min={MIN_AGE}
              max={MAX_AGE}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && check()}
            />
          </label>
          <label>
            <span>
              Your net worth{" "}
              <em
                className="hint"
                title="Everything you own (cash, savings, investments, car) minus everything you owe (loans, cards). A rough estimate is fine."
              >
                what counts?
              </em>
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="12,000"
              value={netWorth}
              onChange={(e) => setNetWorth(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && check()}
            />
          </label>
        </div>

        <button className="builder-toggle" onClick={() => setBuilderOpen((v) => !v)}>
          {builderOpen ? "Hide the calculator" : "Don't know your number? Build it here"}
        </button>

        {builderOpen && (
          <div className="builder">
            <label>
              <span>Cash + savings accounts</span>
              <input type="text" inputMode="decimal" placeholder="3,000" value={builder.cash}
                onChange={(e) => setBuilder({ ...builder, cash: e.target.value })} />
            </label>
            <label>
              <span>Investments + retirement</span>
              <input type="text" inputMode="decimal" placeholder="2,500" value={builder.invest}
                onChange={(e) => setBuilder({ ...builder, invest: e.target.value })} />
            </label>
            <label>
              <span>Car + other property (resale value)</span>
              <input type="text" inputMode="decimal" placeholder="8,000" value={builder.property}
                onChange={(e) => setBuilder({ ...builder, property: e.target.value })} />
            </label>
            <label>
              <span>Debts: loans, cards, everything</span>
              <input type="text" inputMode="decimal" placeholder="4,000" value={builder.debt}
                onChange={(e) => setBuilder({ ...builder, debt: e.target.value })} />
            </label>
            <div className="builder-total">
              <span>Your net worth</span>
              <b className={builderTotal < 0 ? "neg" : ""}>{fmtMoney(builderTotal)}</b>
              <button className="mini" onClick={applyBuilder}>Use this</button>
            </div>
          </div>
        )}

        {error && <div className="error">{error}</div>}
        <button className="cta" onClick={check}>
          Check my rank
        </button>
        <p className="privacy">Anonymous: no signup, no names, nothing stored that identifies you.</p>
      </section>

      {result && bracket && (
        <section className="card result-card" ref={resultRef}>
          <div className="pct-hero">
            <div className="pct-number">
              {ordinal(displayPct)}
              <span className="pct-label">percentile</span>
            </div>
            <div className="pct-meaning">
              <div className="verdict">{verdict(result.pct).title}</div>
              <div className="verdict-sub">{verdict(result.pct).sub}</div>
              <div className="ahead-line">
                Ahead of <b>{Math.round(result.pct)}%</b> of the <b>{bracket.label}</b> age group
                {delta !== null && delta !== 0 && (
                  <span className={`delta ${delta > 0 ? "up" : "down"}`}>
                    {" "}{delta > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(delta))} since your last check
                  </span>
                )}
              </div>
            </div>
          </div>

          <DistributionChart age={result.age} netWorth={result.nw} />

          <div className="stat-row">
            <div className="stat">
              <div className="stat-v">{fmtMoney(result.nw)}</div>
              <div className="stat-k">you</div>
            </div>
            <div className="stat">
              <div className="stat-v">{fmtMoney(bracket.median)}</div>
              <div className="stat-k">median ({bracket.label})</div>
            </div>
            <div className="stat">
              <div className="stat-v">{fmtMoney(bracket.mean)}</div>
              <div className="stat-k">average*</div>
            </div>
            <div className="stat">
              <div className="stat-v">{fmtMoney(netWorthAtPercentile(result.age, 90))}</div>
              <div className="stat-k">top 10% needs</div>
            </div>
          </div>
          <p className="footnote">
            *the average is dragged up by a small number of very wealthy households; median is the honest
            yardstick.
          </p>

          {community && community.communitySize >= 20 && community.communityPct !== null && (
            <div className="community">
              Among <b>{community.communitySize.toLocaleString()}</b> WealthRank users your age, you're ahead
              of <b>{Math.round(community.communityPct)}%</b>
            </div>
          )}
          {breakdown && <CommunityHistogram data={breakdown} netWorth={result.nw} />}

          <div className="future">
            <h2>Your future self</h2>
            <p className="future-sub">
              If you invest <b>{fmtMoney(monthly)}/month</b> at a 7% average annual return:
            </p>
            <input
              className="slider"
              type="range"
              min={0}
              max={2000}
              step={50}
              value={monthly}
              onChange={(e) => setMonthly(Number(e.target.value))}
            />
            <div className="proj-row">
              {proj.map((p) => (
                <div className="proj" key={p.years}>
                  <div className="proj-age">age {p.ageThen}</div>
                  <div className="proj-v">{fmtMoney(p.value)}</div>
                  <div className="proj-pct">{ordinal(p.pctThen)} pct of that age group</div>
                </div>
              ))}
            </div>
            <p className="footnote">
              7% ≈ the long-run inflation-adjusted return of a broad stock index. Educational math, not a
              promise; markets vary.
            </p>
          </div>

          {goal && goalAge && (
            <div className="goal">
              <h2>What would it take?</h2>
              <div className="goal-controls">
                <label>
                  Reach the
                  <select value={goalPct} onChange={(e) => setGoalPct(Number(e.target.value))}>
                    <option value={50}>50th</option>
                    <option value={75}>75th</option>
                    <option value={90}>90th</option>
                    <option value={95}>95th</option>
                  </select>
                  percentile by age
                  <select value={goalAge} onChange={(e) => setGoalAge(Number(e.target.value))}>
                    {[5, 9, 14, 19]
                      .map((d) => result.age + d)
                      .filter((a2) => a2 <= MAX_AGE)
                      .map((a2) => (
                        <option key={a2} value={a2}>
                          {a2}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="goal-answer">
                {goal.monthlyNeeded === 0 ? (
                  <>You're already on track; {fmtMoney(goal.targetValue)} is within reach of your current
                    trajectory.</>
                ) : goal.achievable ? (
                  <>
                    That's <b>{fmtMoney(goal.targetValue)}</b>; you'd need about{" "}
                    <b>{fmtMoney(Math.ceil(goal.monthlyNeeded / 10) * 10)}/month</b> invested at 7%.
                  </>
                ) : (
                  <>
                    That target ({fmtMoney(goal.targetValue)}) needs more than $5K/month from here; try a
                    later age or nearer percentile.
                  </>
                )}
              </div>
            </div>
          )}

          {(() => {
            const rows = serverHistory && serverHistory.length >= 2 ? serverHistory : history;
            if (rows.length < 2) return null;
            return (
              <div className="history">
                <h2>
                  Your progress
                  {synced && <span className="sync-badge">synced to your account</span>}
                </h2>
                <div className="history-list">
                  {rows.slice(-6).map((h) => (
                    <div className="history-row" key={h.ts}>
                      <span className="history-date">
                        {new Date(h.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <span className="history-nw">{fmtMoney(h.nw)}</span>
                      <span className="history-pct">{ordinal(h.pct)} pct</span>
                    </div>
                  ))}
                </div>
                <p className="footnote">
                  {synced
                    ? "Saved to your anonymous account; only you can see this. "
                    : "Stored only in this browser. "}
                  <button
                    className="link-btn"
                    onClick={async () => {
                      await deleteMyData();
                      localStorage.removeItem("wr:history");
                      setServerHistory(null);
                      setHistory([]);
                      setSynced(false);
                    }}
                  >
                    Erase my data
                  </button>
                </p>
              </div>
            );
          })()}

          <button className="cta share" onClick={share}>
            {copied ? "Copied; paste it anywhere" : "Share my rank"}
          </button>
        </section>
      )}

      </>}

      <footer>
        <p>
          Data: Federal Reserve {DATA_VINTAGE}. Percentiles are estimated by fitting the published
          median/mean per age bracket; a close approximation, not audit-grade.
        </p>
        <p>
          WealthRank is educational, not financial advice. Built by{" "}
          <a href="https://poncema4.vercel.app" target="_blank" rel="noreferrer">
            Marco Ponce
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
