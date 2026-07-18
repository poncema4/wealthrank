import { useState } from "react";
import { claimAccount, loginAccount, getToken } from "./lib/api";

/* Header account panel: visible on every tab, never required. Zero-friction
   entry stays (anonymous account auto-creates on first use); this panel lets
   the user CLAIM that account (username + passphrase) or LOG IN to an existing
   one from a new device. Login reloads the app so every tab refetches. */

const UNAME_KEY = "wr:uname";

export function savedUsername(): string {
  try { return localStorage.getItem(UNAME_KEY) ?? ""; } catch { return ""; }
}

export default function Account({ onClose }: { onClose: () => void }) {
  const [uname, setUname] = useState("");
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const known = savedUsername();

  const doClaim = async () => {
    setBusy(true); setMsg("Claiming...");
    const r = await claimAccount(uname.trim(), pass);
    if (r.ok) {
      try { localStorage.setItem(UNAME_KEY, uname.trim().toLowerCase()); } catch { /* noop */ }
      setMsg(`Claimed. You can now log in as "${uname.trim().toLowerCase()}" on any device.`);
    } else setMsg(r.error ?? "Claim failed.");
    setBusy(false);
  };

  const doLogin = async () => {
    setBusy(true); setMsg("Logging in...");
    const r = await loginAccount(uname.trim(), pass);
    if (r.ok) {
      try { localStorage.setItem(UNAME_KEY, uname.trim().toLowerCase()); } catch { /* noop */ }
      setMsg("Logged in. Loading your data...");
      setTimeout(() => window.location.reload(), 600); // every tab refetches fresh
    } else { setMsg(r.error ?? "Login failed."); setBusy(false); }
  };

  return (
    <section className="card acct-panel">
      <div className="acct-head">
        <h2 className="section-title">Your account</h2>
        <button className="ledger-del" onClick={onClose} aria-label="close account panel">×</button>
      </div>
      {known && getToken() ? (
        <p className="future-sub">Signed in as <b>{known}</b> on this device.</p>
      ) : (
        <p className="future-sub">
          Your data already saves to a private anonymous account on this device, no signup needed.
          Claim a username to access it from any device, or log in if you claimed one before.
        </p>
      )}
      <div className="acct-grid">
        <input type="text" placeholder="username (a-z, 0-9, _)" autoCapitalize="off" autoCorrect="off"
          value={uname} onChange={(e) => setUname(e.target.value)} />
        <input type="password" placeholder="passphrase (8+ chars)" value={pass}
          onChange={(e) => setPass(e.target.value)} />
      </div>
      <div className="row-btns">
        <button className="mini" disabled={busy} onClick={doClaim}>Claim this account</button>
        <button className="mini alt" disabled={busy} onClick={doLogin}>Log in</button>
      </div>
      {msg && <p className="import-msg">{msg}</p>}
      <p className="footnote">No email and no reset in v1: keep your passphrase safe. Losing both means starting fresh.</p>
    </section>
  );
}
