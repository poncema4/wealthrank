import { useEffect, useMemo, useRef, useState } from "react";
import {
  INCOME_VINTAGE,
  EXPENSE_CATEGORIES,
  paycheckFromAnnual,
  medianSalaryForAge,
  salaryRatio,
  summarizeMonth,
  runningBalance,
  savingsVerdict,
  TARGET_SAVINGS_RATE,
  type LedgerEntry,
  type PayFrequency,
} from "./lib/money";
import { fmtMoney } from "./lib/percentile";
import { computeInsights } from "./lib/insights";
import { localAiInsights } from "./lib/localAi";
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

/** Downscale a camera photo to a small thumbnail so localStorage survives. */
async function fileToThumbnail(file: File, maxDim = 480): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
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
  const fileRef = useRef<HTMLInputElement>(null);

  // paycheck setup
  const [salaryIn, setSalaryIn] = useState(profile.salary ? String(profile.salary) : "");
  const [freq, setFreq] = useState<PayFrequency>(profile.payFreq ?? "biweekly");

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

  const logPaycheck = async () => {
    if (!profile.salary || !profile.payFreq) return;
    const amt = Math.round(paycheckFromAnnual(profile.salary, profile.payFreq) * 100) / 100;
    await addEntry({ kind: "income", amount: amt, note: "Paycheck", category: "Paycheck", ts: Date.now() });
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
        /* storage full — receipt is a nicety */
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
    const thumb = await fileToThumbnail(f);
    setReceiptPreview(thumb);
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
            <span>Your age (for the salary comparison)</span>
            <input type="number" inputMode="numeric" placeholder="21" value={age}
              onChange={(e) => { setAge(e.target.value); writeLocal("wr:age", e.target.value); }} />
          </label>
        </div>
        <div className="row-btns">
          <button className="mini" onClick={saveProfile}>Save</button>
          {profile.salary && profile.payFreq && (
            <button className="mini alt" onClick={logPaycheck}>
              Log a paycheck (+{fmtMoney(paycheckFromAnnual(profile.salary, profile.payFreq))})
            </button>
          )}
        </div>

        {profile.salary && (
          <div className="salary-compare">
            {ratio !== null ? (
              <>
                Your {fmtMoney(profile.salary)}/yr is <b>{ratio >= 1 ? `${ratio.toFixed(2)}×` : `${ratio.toFixed(2)}×`}</b> the
                estimated median for your age group ({fmtMoney(medianSalaryForAge(a))}/yr).{" "}
                {ratio >= 1 ? "You're out-earning the typical person your age." : "Below the age median — experience moves this fast at your age."}
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
            <div className="stat-v">{summary.savingsRate === null ? "—" : `${Math.round(summary.savingsRate * 100)}%`}</div>
            <div className="stat-k">savings rate</div>
          </div>
        </div>
        <div className="verdict-line">
          <b>{verdict.title}</b>{verdict.sub && <span> — {verdict.sub}</span>}
          {summary.savingsRate !== null && summary.savingsRate < TARGET_SAVINGS_RATE && summary.savingsRate >= 0 && (
            <span> Guideline: keep ~{Math.round(TARGET_SAVINGS_RATE * 100)}% (the 50/30/20 rule).</span>
          )}
        </div>
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
      </section>

      {/* insights */}
      {insights.length > 0 && (
        <section className="card">
          <h2 className="section-title">
            Insights
            <span className={aiInsights ? "sync-badge ai" : "sync-badge"}>
              {aiSource === "server" ? "AI coach" : aiSource === "device" ? "on-device AI — private" : "computed from your ledger"}
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
            The numbers always come from your ledger — {aiSource === "device"
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
          <input type="text" inputMode="decimal" placeholder="Amount — 24.50" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitQuickAdd()} />
          {kind === "expense" && (
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <input type="text" placeholder="Note (optional) — chipotle, gas fill-up" value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitQuickAdd()} />
        </div>
        <div className="row-btns">
          <button className="mini alt" onClick={() => fileRef.current?.click()}>
            {receiptPreview ? "Receipt attached" : "Snap receipt"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => onReceipt(e.target.files?.[0])} />
          <button className="mini" onClick={submitQuickAdd}>Add</button>
        </div>
        {receiptPreview && <img src={receiptPreview} alt="receipt preview" className="receipt-preview" />}
        <p className="footnote">
          Receipts stay on this device only — never uploaded. Amounts sync to your private account.
        </p>
      </section>

      {/* ledger */}
      {entries.length > 0 && (
        <section className="card">
          <h2 className="section-title">Ledger</h2>
          <div className="ledger">
            {[...entries].sort((x, y) => y.ts - x.ts).slice(0, 30).map((e) => {
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
                  {receipt && <img src={receipt} alt="receipt" className="ledger-receipt" />}
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
