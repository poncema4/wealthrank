import { useEffect, useMemo, useRef, useState } from "react";
import {
  INCOME_VINTAGE,
  EXPENSE_CATEGORIES,
  paycheckFromAnnual,
  medianSalaryForAge,
  salaryRatio,
  summarizeMonth,
  runningBalance,
  monthlyHistory,
  missedPaydays,
  budgetStatus,
  EXPENSE_CATEGORIES as CATS,
  savingsVerdict,
  TARGET_SAVINGS_RATE,
  type LedgerEntry,
  type PayFrequency,
} from "./lib/money";
import { fmtMoney } from "./lib/percentile";
import { computeInsights } from "./lib/insights";
import { localAiInsights } from "./lib/localAi";
import { importBankCsv, toLedgerEntries } from "./lib/csv";
import { compareShares, savingsVsNation, CEX_VINTAGE } from "./lib/benchmarks";
import { takeHomeByState, TAX_VINTAGE, ALL_STATES, NO_TAX_STATES, STATE_RATE_LOOKUP_URL } from "./lib/tax";
import {
  fetchLedger,
  addLedgerEntry,
  deleteLedgerEntry,
  saveLedgerProfile,
  fetchAiInsights,
  type LedgerProfile,
} from "./lib/api";

/* Local mirror so the ledger works offline / before the backend answers. */
const LEDGER_KEY = "wr:ledger";
const PROFILE_KEY = "wr:ledprofile";
const RECEIPT_KEY = (id: string) => `wr:receipt:${id}`;

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* full/private */
  }
}

/** Downscale a camera photo to a small thumbnail so localStorage survives.
 * Two decode paths: createImageBitmap (fast), then an <img> element fallback
 * for browsers/formats where the first fails. Never fails silently. */
async function fileToThumbnail(file: File, maxDim = 480): Promise<string | null> {
  const draw = (w: number, h: number, src: CanvasImageSource): string => {
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(Math.round(w * scale), 1);
    canvas.height = Math.max(Math.round(h * scale), 1);
    canvas.getContext("2d")!.drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  };
  // onload-based <img> loader: img.decode() rejects on iOS Safari for large
  // camera captures (EncodingError), while onload succeeds for the same file
  const viaImg = (src: string): Promise<string | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try { resolve(draw(img.naturalWidth, img.naturalHeight, img)); }
        catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  try {
    const bmp = await createImageBitmap(file);
    return draw(bmp.width, bmp.height, bmp);
  } catch {
    /* fall through */
  }
  const url = URL.createObjectURL(file);
  try {
    const fromUrl = await viaImg(url);
    if (fromUrl) return fromUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
  // last resort: FileReader data URL, the most compatible path old iOS has
  const dataUrl = await new Promise<string | null>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
  return dataUrl ? viaImg(dataUrl) : null;
}

function Sparkline({ entries }: { entries: LedgerEntry[] }) {
  const pts = useMemo(() => runningBalance(entries), [entries]);
  if (pts.length < 2) return null;
  const W = 560, H = 80, P = 4;
  const min = Math.min(...pts.map((p) => p.balance), 0);
  const max = Math.max(...pts.map((p) => p.balance), 1);
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (b: number) => H - P - ((b - min) / (max - min || 1)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.balance)}`).join(" ");
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Running balance over time">
      {min < 0 && <line x1={P} y1={zeroY} x2={W - P} y2={zeroY} stroke="#8b98a5" strokeWidth="1" strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke="#3ddc84" strokeWidth="2" />
    </svg>
  );
}

function MonthTrend({ entries }: { entries: LedgerEntry[] }) {
  const rows = useMemo(() => monthlyHistory(entries), [entries]);
  if (rows.length < 2) return null; // needs two months before a trend means anything
  const W = 560, H = 150, P = 8, LABEL_H = 18;
  const maxV = Math.max(...rows.map((r) => Math.max(r.income, r.expenses)), 1);
  const band = (W - 2 * P) / rows.length;
  const barW = Math.min(band * 0.28, 26);
  const y = (v: number) => H - P - (v / maxV) * (H - 2 * P - LABEL_H);
  // net trendline: map net onto its own scale spanning the same plot area
  const nets = rows.map((r) => r.net);
  const nMin = Math.min(...nets, 0), nMax = Math.max(...nets, 1);
  const ny = (v: number) => H - P - ((v - nMin) / (nMax - nMin || 1)) * (H - 2 * P - LABEL_H);
  const cx = (i: number) => P + band * i + band / 2;
  const line = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${cx(i)} ${ny(r.net)}`).join(" ");
  return (
    <section className="card">
      <h2 className="section-title">Month by month</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly income, expenses, and net trend">
        {rows.map((r, i) => (
          <g key={r.month}>
            <rect x={cx(i) - barW - 2} y={y(r.income)} width={barW} height={H - P - LABEL_H - y(r.income) + (LABEL_H - 0)} fill="#3ddc84" opacity="0.85" rx="3" />
            <rect x={cx(i) + 2} y={y(r.expenses)} width={barW} height={H - P - LABEL_H - y(r.expenses) + (LABEL_H - 0)} fill="#ff9d6b" opacity="0.85" rx="3" />
            <text x={cx(i)} y={H - 4} textAnchor="middle" className="chart-label">{r.label}</text>
          </g>
        ))}
        <path d={line} fill="none" stroke="#22b8cf" strokeWidth="2.5" strokeLinejoin="round" />
        {rows.map((r, i) => (
          <circle key={r.month} cx={cx(i)} cy={ny(r.net)} r="3.5" fill="#22b8cf" />
        ))}
      </svg>
      <div className="trend-legend">
        <span><i className="dot-g" /> income</span>
        <span><i className="dot-o" /> expenses</span>
        <span><i className="dot-c" /> net (kept)</span>
      </div>
      <div className="trend-rows">
        {[...rows].reverse().map((r) => (
          <div className="trend-row" key={r.month}>
            <span className="trend-month">{r.label}</span>
            <span className="pos">+{fmtMoney(r.income)}</span>
            <span className="neg2">−{fmtMoney(r.expenses)}</span>
            <span className="trend-net">{r.net >= 0 ? "+" : ""}{fmtMoney(r.net)}</span>
            <span className="trend-rate">{r.savingsRate === null ? "-" : `${Math.round(r.savingsRate * 100)}%`}</span>
          </div>
        ))}
      </div>
      <p className="footnote">
        Every month you log builds this automatically; on the 1st, "This month" resets while the
        finished month locks in here forever.
      </p>
    </section>
  );
}

export default function Money() {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => readLocal(LEDGER_KEY, []));
  const [profile, setProfile] = useState<LedgerProfile>(() => readLocal(PROFILE_KEY, {}));
  const [synced, setSynced] = useState(false);
  const [age, setAge] = useState<string>(() => readLocal("wr:age", ""));

  // quick-add form
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<string>("Food");
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptBump, setReceiptBump] = useState(0); // re-render after receipt add/remove
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState("");
  const [budgetsOpen, setBudgetsOpen] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<Record<string, string>>({});

  // paycheck setup
  const [salaryIn, setSalaryIn] = useState(profile.salary ? String(profile.salary) : "");
  const [freq, setFreq] = useState<PayFrequency>(profile.payFreq ?? "biweekly");
  const [stateCode, setStateCode] = useState<string>(() => readLocal("wr:taxstatecode", ""));

  useEffect(() => {
    fetchLedger().then((r) => {
      if (r) {
        setEntries(r.entries);
        writeLocal(LEDGER_KEY, r.entries);
        if (r.profile.salary || r.profile.payFreq) {
          setProfile(r.profile);
          writeLocal(PROFILE_KEY, r.profile);
          if (r.profile.salary) setSalaryIn(String(r.profile.salary));
          if (r.profile.payFreq) setFreq(r.profile.payFreq);
        }
        setSynced(true);
      }
    });
  }, []);

  const month = new Date().toISOString().slice(0, 7);
  const summary = useMemo(() => summarizeMonth(entries, month), [entries, month]);
  const verdict = savingsVerdict(summary.savingsRate);
  const insights = useMemo(() => computeInsights(entries), [entries]);
  const [aiInsights, setAiInsights] = useState<string[] | null>(null);
  const [aiSource, setAiSource] = useState<"server" | "device" | null>(null);

  useEffect(() => {
    if (insights.length === 0) { setAiInsights(null); setAiSource(null); return; }
    const facts = insights.map((i) => i.text);
    const t = setTimeout(async () => {
      // chain: server LLM (if a key is configured) -> on-device Gemini Nano
      // (Chrome built-in, keyless + private) -> deterministic layer
      const server = await fetchAiInsights(facts, Number(age) || undefined);
      if (server) { setAiInsights(server); setAiSource("server"); return; }
      const local = await localAiInsights(facts, Number(age) || undefined);
      if (local) { setAiInsights(local); setAiSource("device"); return; }
      setAiInsights(null); setAiSource(null);
    }, 800); // debounce: don't hammer models on every keystroke of entries
    return () => clearTimeout(t);
  }, [insights, age]);

  const saveProfile = async () => {
    const salary = Math.round(Number(salaryIn.replace(/[,$\s]/g, "")));
    if (!Number.isFinite(salary) || salary <= 0) return;
    const p: LedgerProfile = { salary, payFreq: freq };
    setProfile(p);
    writeLocal(PROFILE_KEY, p);
    saveLedgerProfile(p).then(setSynced);
  };

  const tax = profile.salary && stateCode ? takeHomeByState(profile.salary, stateCode) : null;

  const logPaycheck = async () => {
    if (!profile.salary || !profile.payFreq) return;
    // log the NET take-home per paycheck (what actually hits the bank)
    const yearlyNet = tax ? tax.net : profile.salary;
    const amt = Math.round(paycheckFromAnnual(yearlyNet, profile.payFreq) * 100) / 100;
    await addEntry({ kind: "income", amount: amt, note: "Paycheck", category: "Paycheck", ts: Date.now() });
    const p = { ...profile, payAnchor: Date.now() };
    setProfile(p); writeLocal(PROFILE_KEY, p);
    saveLedgerProfile({ payAnchor: p.payAnchor });
  };

  const missed = profile.payAnchor && profile.payFreq && profile.salary
    ? missedPaydays(profile.payAnchor, profile.payFreq)
    : [];

  const logMissed = async () => {
    if (!profile.salary || !profile.payFreq || missed.length === 0) return;
    const yearlyNet = tax ? tax.net : profile.salary;
    const amt = Math.round(paycheckFromAnnual(yearlyNet, profile.payFreq) * 100) / 100;
    for (const ts of missed) {
      await addEntry({ kind: "income", amount: amt, note: "Paycheck (auto)", category: "Paycheck", ts });
    }
    const p = { ...profile, payAnchor: missed[missed.length - 1] };
    setProfile(p); writeLocal(PROFILE_KEY, p);
    saveLedgerProfile({ payAnchor: p.payAnchor });
  };

  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    setImportMsg("Reading file...");
    const text = await f.text();
    const { rows, skipped } = importBankCsv(text);
    if (rows.length === 0) { setImportMsg("Could not find date/description/amount columns in that file."); return; }
    const capped = rows.slice(0, 200);
    setImportMsg(`Importing ${capped.length} transactions...`);
    let done = 0;
    for (const e of toLedgerEntries(capped)) { await addEntry(e); done++; }
    setImportMsg(`Imported ${done} transactions, auto-categorized${skipped ? `; ${skipped} rows skipped` : ""}.`);
  };

  const saveBudgets = async () => {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(budgetDraft)) {
      const n = Math.round(Number(String(v).replace(/[,$\s]/g, "")));
      if (Number.isFinite(n) && n > 0) clean[k] = n;
    }
    const p = { ...profile, budgets: clean };
    setProfile(p); writeLocal(PROFILE_KEY, p);
    saveLedgerProfile({ budgets: clean }).then(setSynced);
    setBudgetsOpen(false);
  };

  const addEntry = async (e: Omit<LedgerEntry, "id">) => {
    const optimistic: LedgerEntry = { ...e, id: `local-${crypto.randomUUID()}` };
    let saved = optimistic;
    const server = await addLedgerEntry(e);
    if (server) {
      saved = server;
      setSynced(true);
    }
    setEntries((prev) => {
      const next = [...prev, saved];
      writeLocal(LEDGER_KEY, next);
      return next;
    });
    if (receiptPreview) {
      try {
        localStorage.setItem(RECEIPT_KEY(saved.id), receiptPreview);
      } catch {
        /* storage full; receipt is a nicety */
      }
      setReceiptPreview(null);
    }
  };

  const submitQuickAdd = async () => {
    const amt = Number(amount.replace(/[,$\s]/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) return;
    await addEntry({
      kind,
      amount: Math.round(amt * 100) / 100,
      note: note.trim().slice(0, 80),
      category: kind === "income" ? "Income" : category,
      ts: Date.now(),
    });
    setAmount("");
    setNote("");
  };

  const removeEntry = async (id: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      writeLocal(LEDGER_KEY, next);
      return next;
    });
    try {
      localStorage.removeItem(RECEIPT_KEY(id));
    } catch { /* noop */ }
    if (!id.startsWith("local-")) deleteLedgerEntry(id);
  };

  const onReceipt = async (f: File | undefined) => {
    if (!f) return;
    setImportMsg("Reading photo...");
    const thumb = await fileToThumbnail(f);
    setReceiptPreview(thumb);
    if (thumb) {
      setImportMsg("Receipt attached. Add the amount and hit Add.");
    } else {
      // name the exact format+size so a failure report diagnoses itself;
      // HEIC (iPhone) is undecodable in some browsers - screenshots are always PNG
      const kind = f.type || "unknown format";
      const mb = (f.size / 1_000_000).toFixed(1);
      setImportMsg(
        `Could not read that photo (${kind}, ${mb}MB). Your browser may not support this ` +
        "format. Quick fix: screenshot the receipt photo and attach the screenshot instead."
      );
    }
  };

  const a = Math.floor(Number(age));
  const ratio =
    profile.salary && Number.isFinite(a) && a >= 16 ? salaryRatio(a, profile.salary) : null;

  return (
    <div>
      {/* paycheck setup */}
      <section className="card">
        <h2 className="section-title">
          Your paycheck
          {synced && <span className="sync-badge">synced to your account</span>}
        </h2>
        <div className="pay-grid">
          <label>
            <span>Yearly salary (before tax)</span>
            <input type="text" inputMode="decimal" placeholder="62,000" value={salaryIn}
              onChange={(e) => setSalaryIn(e.target.value)} />
          </label>
          <label>
            <span>How you're paid</span>
            <select value={freq} onChange={(e) => setFreq(e.target.value as PayFrequency)}>
              <option value="weekly">Weekly (52/yr)</option>
              <option value="biweekly">Biweekly (26/yr)</option>
              <option value="semimonthly">Twice a month (24/yr)</option>
              <option value="monthly">Monthly (12/yr)</option>
            </select>
          </label>
          <label>
            <span>Your state</span>
            <select
              value={stateCode}
              onChange={(e) => { setStateCode(e.target.value); writeLocal("wr:taxstatecode", e.target.value); }}
            >
              <option value="">Pick your state...</option>
              {ALL_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}{NO_TAX_STATES.includes(code) || code === "WA" ? " (no wage tax)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Your age (for the salary comparison)</span>
            <input type="number" inputMode="numeric" placeholder="21" value={age}
              onChange={(e) => { setAge(e.target.value); writeLocal("wr:age", e.target.value); }} />
          </label>
        </div>
        <div className="row-btns">
          <button className="mini" onClick={saveProfile}>Save</button>
          {profile.salary && profile.payFreq && (
            <button className="mini alt" onClick={logPaycheck}>
              Log a paycheck (+{fmtMoney(paycheckFromAnnual(tax ? tax.net : profile.salary, profile.payFreq))} take-home)
            </button>
          )}
        </div>

        {tax && profile.payFreq && (
          <div className="takehome">
            <div className="takehome-head">
              Take-home estimate: <b>{fmtMoney(tax.net)}/yr</b> after {Math.round(tax.effectiveRate * 100)}% total tax
            </div>
            <div className="takehome-taxes">
              Federal {fmtMoney(tax.federal)} · Social Security + Medicare {fmtMoney(tax.fica)}
              {tax.state > 0 && <> · State {fmtMoney(tax.state)}</>}
            </div>
            <div className="takehome-grid">
              {([["Weekly", 52], ["Biweekly", 26], ["Twice a month", 24], ["Monthly", 12]] as const).map(([label, n]) => (
                <div className={`takehome-cell${profile.payFreq === ({52:"weekly",26:"biweekly",24:"semimonthly",12:"monthly"} as const)[n] ? " current" : ""}`} key={label}>
                  <div className="takehome-v">{fmtMoney(tax.net / n)}</div>
                  <div className="takehome-k">{label}</div>
                </div>
              ))}
            </div>
            <div className="footnote">
              {TAX_VINTAGE} federal; state brackets per Tax Foundation, all 50 states + DC.
              Estimate only: no 401k, health premiums, state deductions/credits, or local taxes.{" "}
              <a className="hint-link" href={STATE_RATE_LOOKUP_URL} target="_blank" rel="noreferrer">source</a>
            </div>
          </div>
        )}
        {profile.salary && (
          <div className="salary-compare">
            {ratio !== null ? (
              <>
                Your {fmtMoney(profile.salary)}/yr is <b>{ratio >= 1 ? `${ratio.toFixed(2)}×` : `${ratio.toFixed(2)}×`}</b> the
                estimated median for your age group ({fmtMoney(medianSalaryForAge(a))}/yr).{" "}
                {ratio >= 1 ? "You're out-earning the typical person your age." : "Below the age median; experience moves this fast at your age."}
              </>
            ) : (
              <>Add your age to compare your salary against your age group.</>
            )}
            <div className="footnote">{INCOME_VINTAGE}. Full-time workers, pre-tax.</div>
          </div>
        )}
      </section>

      {/* this month */}
      <section className="card">
        <h2 className="section-title">This month</h2>
        <div className="stat-row">
          <div className="stat"><div className="stat-v pos">{fmtMoney(summary.income)}</div><div className="stat-k">income</div></div>
          <div className="stat"><div className="stat-v neg2">{fmtMoney(summary.expenses)}</div><div className="stat-k">expenses</div></div>
          <div className="stat"><div className="stat-v">{fmtMoney(summary.net)}</div><div className="stat-k">kept</div></div>
          <div className="stat">
            <div className="stat-v">{summary.savingsRate === null ? "-" : `${Math.round(summary.savingsRate * 100)}%`}</div>
            <div className="stat-k">savings rate</div>
          </div>
        </div>
        <div className="verdict-line">
          <b>{verdict.title}</b>{verdict.sub && <span>; {verdict.sub}</span>}
          {summary.savingsRate !== null && summary.savingsRate < TARGET_SAVINGS_RATE && summary.savingsRate >= 0 && (
            <span> Guideline: keep ~{Math.round(TARGET_SAVINGS_RATE * 100)}% (the 50/30/20 rule).</span>
          )}
        </div>
        {savingsVsNation(summary.savingsRate) && (
          <div className="natl-line">{savingsVsNation(summary.savingsRate)}</div>
        )}
        {compareShares(summary).length > 0 && (
          <div className="share-rows">
            {compareShares(summary).map((r) => (
              <div className="share-row" key={r.label}>
                <span className="share-label">{r.label}</span>
                <span>
                  <b>{Math.round(r.yourShare * 100)}%</b> of your spending vs{" "}
                  {Math.round(r.nationalShare * 100)}% for the average household
                  <em className={r.delta > 0.05 ? "hot" : "cool"}>
                    {r.delta > 0.05 ? " higher than typical" : r.delta < -0.05 ? " lower than typical" : " about typical"}
                  </em>
                </span>
              </div>
            ))}
            <div className="footnote">{CEX_VINTAGE}. Shares of total spending, so the comparison is fair at any income.</div>
          </div>
        )}
        {Object.keys(summary.byCategory).length > 0 && (
          <div className="cat-row">
            {Object.entries(summary.byCategory)
              .sort((x, y) => y[1] - x[1])
              .map(([c, v]) => (
                <span className="cat-chip" key={c}>{c} {fmtMoney(v)}</span>
              ))}
          </div>
        )}
        <Sparkline entries={entries} />

        {summary.income > 0 && (
          <button
            className="mini alt"
            style={{ marginTop: 12 }}
            onClick={async () => {
              const rate = summary.savingsRate === null ? "" : `, kept ${Math.round(summary.savingsRate * 100)}% of my income`;
              const text = `My month on WealthRank: ${fmtMoney(summary.income)} in, ${fmtMoney(summary.expenses)} out${rate}. Track yours: wealthrank-ai.vercel.app`;
              try {
                if (navigator.share) { await navigator.share({ text }); return; }
              } catch { /* cancelled */ }
              try { await navigator.clipboard.writeText(text); setImportMsg("Month summary copied. Paste it anywhere."); } catch { /* blocked */ }
            }}
          >
            Share my month
          </button>
        )}

        {profile.budgets && Object.keys(profile.budgets).length > 0 && (
          <div className="budgets">
            {budgetStatus(summary, profile.budgets).map((b) => (
              <div className="budget-row" key={b.category}>
                <span className="budget-name">{b.category}</span>
                <div className="budget-bar">
                  <div className={`budget-fill${b.over ? " over" : ""}`} style={{ width: `${Math.min(b.share, 1) * 100}%` }} />
                </div>
                <span className={`budget-amt${b.over ? " over-t" : ""}`}>
                  {fmtMoney(b.spent)} / {fmtMoney(b.cap)}{b.over ? " over!" : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <button className="builder-toggle" onClick={() => {
          setBudgetsOpen((v) => !v);
          if (!budgetsOpen) {
            const d: Record<string, string> = {};
            for (const c of CATS) d[c] = profile.budgets?.[c] ? String(profile.budgets[c]) : "";
            setBudgetDraft(d);
          }
        }}>
          {budgetsOpen ? "Hide budget editor" : profile.budgets && Object.keys(profile.budgets).length ? "Edit category budgets" : "Set category budgets"}
        </button>
        {budgetsOpen && (
          <div className="builder">
            {CATS.map((c) => (
              <label key={c}>
                <span>{c} monthly cap</span>
                <input type="text" inputMode="decimal" placeholder="300" value={budgetDraft[c] ?? ""}
                  onChange={(e) => setBudgetDraft({ ...budgetDraft, [c]: e.target.value })} />
              </label>
            ))}
            <div className="builder-total">
              <span>Leave blank for no cap</span>
              <button className="mini" onClick={saveBudgets}>Save budgets</button>
            </div>
          </div>
        )}
      </section>

      {missed.length > 0 && (
        <section className="card catchup">
          <b>{missed.length} paycheck{missed.length > 1 ? "s" : ""} since your last log.</b>{" "}
          Based on your {profile.payFreq} schedule, want to add {missed.length > 1 ? "them" : "it"} now?
          <button className="mini" onClick={logMissed}>
            Log {missed.length} paycheck{missed.length > 1 ? "s" : ""} (+{fmtMoney(Math.round(paycheckFromAnnual(profile.salary!, profile.payFreq!) * missed.length))})
          </button>
        </section>
      )}

      <MonthTrend entries={entries} />

      {/* insights */}
      {insights.length > 0 && (
        <section className="card">
          <h2 className="section-title">
            Insights
            <span className={aiInsights ? "sync-badge ai" : "sync-badge"}>
              {aiSource === "server" ? "AI coach" : aiSource === "device" ? "on-device AI (private)" : "computed from your ledger"}
            </span>
          </h2>
          <div className="insights">
            {(aiInsights ?? insights.map((i) => i.text)).map((text, idx) => (
              <div className="insight" key={idx}>
                <span className="insight-icon">{aiInsights ? "◆" : insights[idx]?.icon ?? "◆"}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <p className="footnote">
            The numbers always come from your ledger; {aiSource === "device"
              ? "phrased by AI running entirely on your device; nothing was sent anywhere."
              : aiInsights
              ? "the AI only phrases them."
              : "AI phrasing activates automatically in browsers with built-in AI (Chrome), or when the server has a model key."}
          </p>
        </section>
      )}

      {/* quick add */}
      <section className="card">
        <h2 className="section-title">Add money in / out</h2>
        <div className="add-grid">
          <div className="kind-toggle">
            <button className={kind === "expense" ? "on" : ""} onClick={() => setKind("expense")}>Expense</button>
            <button className={kind === "income" ? "on" : ""} onClick={() => setKind("income")}>Income</button>
          </div>
          <input type="text" inputMode="decimal" placeholder="Amount" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitQuickAdd()} />
          {kind === "expense" && (
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <input type="text" placeholder="Note: chipotle, gas..." value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitQuickAdd()} />
        </div>
        <div className="row-btns">
          <button className="mini alt" onClick={() => fileRef.current?.click()}>
            {receiptPreview ? "Receipt attached" : "Snap receipt"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => onReceipt(e.target.files?.[0])} />
          <button className="mini alt" onClick={() => csvRef.current?.click()}>Import bank CSV</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv(e.target.files?.[0])} />
          <button className="mini" onClick={submitQuickAdd}>Add</button>
        </div>
        {importMsg && <p className="import-msg">{importMsg}</p>}
        {receiptPreview && (
          <div className="receipt-wrap">
            <img src={receiptPreview} alt="receipt preview" className="receipt-preview" />
            <button className="receipt-x" onClick={() => { setReceiptPreview(null); setImportMsg("Receipt removed."); }} aria-label="remove attached receipt">×</button>
          </div>
        )}
        <p className="footnote">
          Receipts stay on this device only, never uploaded. Amounts sync to your private account.
        </p>
      </section>

      {/* ledger */}
      {entries.length > 0 && (
        <section className="card">
          <h2 className="section-title">Ledger</h2>
          <div className="ledger">
            {receiptBump >= 0 && [...entries].sort((x, y) => y.ts - x.ts).slice(0, 30).map((e) => {
              let receipt: string | null = null;
              try { receipt = localStorage.getItem(RECEIPT_KEY(e.id)); } catch { /* noop */ }
              return (
                <div className="ledger-row" key={e.id}>
                  <span className="ledger-date">
                    {new Date(e.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  <span className="ledger-desc">
                    {e.note || e.category}
                    <em>{e.category}</em>
                  </span>
                  {receipt && (
                    <span className="receipt-wrap sm">
                      <img src={receipt} alt="receipt" className="ledger-receipt" />
                      <button
                        className="receipt-x sm"
                        aria-label="remove receipt from this entry"
                        onClick={() => {
                          try { localStorage.removeItem(RECEIPT_KEY(e.id)); } catch { /* noop */ }
                          setReceiptBump((v) => v + 1);
                        }}
                      >×</button>
                    </span>
                  )}
                  <span className={`ledger-amt ${e.kind === "income" ? "pos" : "neg2"}`}>
                    {e.kind === "income" ? "+" : "−"}{fmtMoney(e.amount)}
                  </span>
                  <button className="ledger-del" onClick={() => removeEntry(e.id)} aria-label="delete entry">×</button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
