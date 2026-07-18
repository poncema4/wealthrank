/**
 * Bank CSV import: parse real-world bank exports and categorize transactions.
 *
 * Parsing is defensive: banks disagree on headers, date formats, and whether
 * money-out is negative or a separate Debit column. Categorization runs a
 * keyword rules engine (instant, offline); rows it can't place land in "Other"
 * where the optional on-device AI pass can refine them.
 */

import type { LedgerEntry, LedgerKind } from "./money";

export type ParsedRow = { ts: number; kind: LedgerKind; amount: number; note: string; category: string };

/* ---------- tiny CSV parser (handles quoted fields with commas) ---------- */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/* ---------- column detection ---------- */

const DATE_HEADERS = ["date", "transaction date", "posted date", "posting date"];
const DESC_HEADERS = ["description", "memo", "name", "payee", "details", "transaction"];
const AMOUNT_HEADERS = ["amount", "transaction amount"];
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawals", "money out"];
const CREDIT_HEADERS = ["credit", "deposit", "deposits", "money in"];

function findCol(headers: string[], candidates: string[]): number {
  const h = headers.map((x) => x.trim().toLowerCase());
  for (const c of candidates) {
    const i = h.findIndex((x) => x === c || x.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

function parseDate(s: string): number | null {
  const t = s.trim();
  // ISO first, then US m/d/y
  let d = new Date(t);
  if (!isNaN(d.getTime()) && /\d{4}/.test(t)) return d.getTime();
  const us = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const [, m, day, y] = us;
    const year = Number(y.length === 2 ? "20" + y : y);
    d = new Date(year, Number(m) - 1, Number(day));
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return null;
}

function parseAmount(s: string): number | null {
  const cleaned = s.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/* ---------- categorization rules ---------- */

const RULES: [RegExp, string][] = [
  [/rent|landlord|apartment|property mgmt|zelle.*rent/i, "Rent"],
  [/uber\s?eats|doordash|grubhub|chipotle|mcdonald|wendy|taco|pizza|restaurant|cafe|starbucks|dunkin|deli|grill|kitchen|food/i, "Food"],
  [/shell|exxon|chevron|bp\b|sunoco|wawa|gas|fuel/i, "Gas"],
  [/geico|progressive|state farm|allstate|autozone|jiffy|car wash|dmv|toll|ezpass|e-?zpass|parking/i, "Car"],
  [/netflix|spotify|hulu|disney|hbo|max\b|youtube|apple\.com|icloud|prime|subscription|patreon|twitch|playstation|xbox|steam/i, "Subscriptions"],
  [/amc|cinema|ticketmaster|stubhub|bar\b|brewery|bowling|golf|arcade/i, "Fun"],
  [/tuition|university|college|textbook|chegg|coursera|udemy/i, "School"],
  [/payroll|direct dep|salary|paycheck|employer|adp\b|gusto/i, "Paycheck"],
];

export function categorize(description: string): string {
  for (const [re, cat] of RULES) if (re.test(description)) return cat;
  return "Other";
}

/* ---------- the full import pipeline ---------- */

export type ImportResult = { rows: ParsedRow[]; skipped: number };

export function importBankCsv(text: string): ImportResult {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skipped: grid.length };
  const headers = grid[0];
  const dateCol = findCol(headers, DATE_HEADERS);
  const descCol = findCol(headers, DESC_HEADERS);
  const amtCol = findCol(headers, AMOUNT_HEADERS);
  const debitCol = findCol(headers, DEBIT_HEADERS);
  const creditCol = findCol(headers, CREDIT_HEADERS);
  if (dateCol === -1 || descCol === -1 || (amtCol === -1 && debitCol === -1 && creditCol === -1)) {
    return { rows: [], skipped: grid.length - 1 };
  }

  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const r of grid.slice(1)) {
    const ts = parseDate(r[dateCol] ?? "");
    const note = (r[descCol] ?? "").trim().slice(0, 80);
    let amount: number | null = null;
    let kind: LedgerKind = "expense";
    if (amtCol !== -1) {
      amount = parseAmount(r[amtCol] ?? "");
      if (amount !== null) {
        kind = amount >= 0 ? "income" : "expense";
        amount = Math.abs(amount);
      }
    } else {
      const debit = debitCol !== -1 ? parseAmount(r[debitCol] ?? "") : null;
      const credit = creditCol !== -1 ? parseAmount(r[creditCol] ?? "") : null;
      if (debit && debit !== 0) { amount = Math.abs(debit); kind = "expense"; }
      else if (credit && credit !== 0) { amount = Math.abs(credit); kind = "income"; }
    }
    if (ts === null || amount === null || amount === 0 || !note) { skipped++; continue; }
    const category = kind === "income" ? (categorize(note) === "Paycheck" ? "Paycheck" : "Income") : categorize(note);
    rows.push({ ts, kind, amount: Math.round(amount * 100) / 100, note, category });
  }
  return { rows, skipped };
}

export function toLedgerEntries(rows: ParsedRow[]): Omit<LedgerEntry, "id">[] {
  return rows.map((r) => ({ ts: r.ts, kind: r.kind, amount: r.amount, note: r.note, category: r.category }));
}
