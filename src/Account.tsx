import { useState } from "react";
import { claimAccount, loginAccount, getToken } from "./lib/api";

/* Header account panel. Three states, each shown alone:
   1. signed in (claimed)  -> identity card + Log out
   2. anonymous            -> segmented Claim / Log in form
   Logout only exists for CLAIMED accounts: logging out of an unclaimed
   anonymous account would orphan its data, so we never offer it there. */

const UNAME_KEY = "wr:uname";

export function savedUsername(): string {
  try { return localStorage.getItem(UNAME_KEY) ?? ""; } catch { return ""; }
}

function clearLocal(keys: string[]) {
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch { /* noop */ }
  }
}

export default function Account({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"claim" | "login">("claim");
  const [uname, setUname] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(savedUsername() && getToken());

  const submit = async () => {
    setBusy(true);
    setMsg(mode === "claim" ? "Claiming..." : "Logging in...");
    const r = mode === "claim"
      ? await claimAccount(uname.trim(), pass)
      : await loginAccount(uname.trim(), pass);
    if (r.ok) {
      try { localStorage.setItem(UNAME_KEY, uname.trim().toLowerCase()); } catch { /* noop */ }
      if (mode === "login") {
        setMsg("Logged in. Loading your data...");
        setTimeout(() => window.location.reload(), 500);
        return;
      }
      setMsg("Account claimed. You can now log in from any device.");
    } else {
      setMsg(r.error ?? "Something went wrong.");
    }
    setBusy(false);
  };

  const logout = () => {
    // token + identity + local mirrors; server data stays safe under the username
    clearLocal(["wr:token", UNAME_KEY, "wr:ledger", "wr:ledprofile", "wr:history"]);
    window.location.reload();
  };

  if (signedIn) {
    const name = savedUsername();
    return (
      <section className="card acct-panel">
        <div className="acct-head">
          <h2 className="section-title">Your account</h2>
          <button className="ledger-del" onClick={onClose} aria-label="close account panel">×</button>
        </div>
        <div className="acct-id">
          <div className="acct-avatar">{name[0]?.toUpperCase()}</div>
          <div>
            <div className="acct-name">{name}</div>
            <div className="acct-sub">Everything you log syncs privately to this account.</div>
          </div>
        </div>
        <div className="row-btns">
          <button className="mini alt danger" onClick={logout}>Log out on this device</button>
        </div>
        <p className="footnote">
          Logging out clears this device only; your data stays safe under your username and
          passphrase.
        </p>
      </section>
    );
  }

  return (
    <section className="card acct-panel">
      <div className="acct-head">
        <h2 className="section-title">Your account</h2>
        <button className="ledger-del" onClick={onClose} aria-label="close account panel">×</button>
      </div>

      <div className="kind-toggle acct-mode">
        <button className={mode === "claim" ? "on" : ""} onClick={() => { setMode("claim"); setMsg(""); }}>
          Create username
        </button>
        <button className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setMsg(""); }}>
          Log in
        </button>
      </div>

      <p className="future-sub">
        {mode === "claim"
          ? "Your data already saves privately on this device with no signup. Add a username and passphrase to unlock it from your phone, laptop, anywhere."
          : "Already created a username? Log in and this device becomes your account."}
      </p>

      <div className="acct-grid">
        <input type="text" placeholder="username (a-z, 0-9, _)" autoCapitalize="off" autoCorrect="off"
          value={uname} onChange={(e) => setUname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        <input type="password" placeholder="passphrase (8+ characters)" value={pass}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
      </div>
      <button className="cta acct-cta" disabled={busy} onClick={submit}>
        {mode === "claim" ? "Create my account" : "Log in"}
      </button>
      {msg && <p className="import-msg">{msg}</p>}
      <p className="footnote">
        No email, no tracking. There is also no reset in v1, so keep your passphrase safe.
      </p>
    </section>
  );
}
