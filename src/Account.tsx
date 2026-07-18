import { useState } from "react";
import { claimAccount, loginAccount, getToken } from "./lib/api";

/* Sign-in modal, platform-style: dimmed backdrop, centered card, labeled
   fields, one primary action, switch-mode link. Entry to the app stays
   zero-friction; this only appears when the user opens it. */

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
  const [showPass, setShowPass] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const signedIn = Boolean(savedUsername() && getToken());

  const submit = async () => {
    if (busy) return;
    setBusy(true); setOk(false);
    setMsg(mode === "claim" ? "Creating your account..." : "Signing in...");
    const r = mode === "claim"
      ? await claimAccount(uname.trim(), pass)
      : await loginAccount(uname.trim(), pass);
    if (r.ok) {
      try { localStorage.setItem(UNAME_KEY, uname.trim().toLowerCase()); } catch { /* noop */ }
      setOk(true);
      if (mode === "login") {
        setMsg("Signed in. Loading your data...");
        setTimeout(() => window.location.reload(), 500);
        return;
      }
      setMsg("Account created. You can now sign in from any device.");
    } else {
      setMsg(r.error ?? "Something went wrong.");
    }
    setBusy(false);
  };

  const logout = () => {
    clearLocal(["wr:token", UNAME_KEY, "wr:ledger", "wr:ledprofile", "wr:history"]);
    window.location.reload();
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Account">
        <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        <div className="modal-logo">
          Wealth<span>Rank</span>
        </div>

        {signedIn ? (
          <>
            <div className="acct-id center-col">
              <div className="acct-avatar lg">{savedUsername()[0]?.toUpperCase()}</div>
              <div className="acct-name">{savedUsername()}</div>
              <div className="acct-sub">Your data syncs privately to this account.</div>
            </div>
            <button className="cta modal-cta" onClick={logout}>Sign out</button>
            <p className="modal-note">
              Signing out clears this device only. Your data stays saved to your account.
            </p>
          </>
        ) : (
          <>
            <h2 className="modal-title">{mode === "claim" ? "Create your account" : "Sign in"}</h2>
            <p className="modal-sub">
              {mode === "claim"
                ? "Keep your progress on every device."
                : "Welcome back."}
            </p>

            <label className="modal-field">
              <span>Username</span>
              <input type="text" placeholder="yourname" autoCapitalize="off" autoCorrect="off"
                autoComplete="username"
                value={uname} onChange={(e) => setUname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
            </label>
            <label className="modal-field">
              <span>Passphrase</span>
              <div className="pass-wrap">
                <input type={showPass ? "text" : "password"} placeholder="8+ characters"
                  autoComplete={mode === "claim" ? "new-password" : "current-password"}
                  value={pass} onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
                <button type="button" className="pass-eye" onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "hide passphrase" : "show passphrase"}>
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            <button className="cta modal-cta" disabled={busy} onClick={submit}>
              {mode === "claim" ? "Create account" : "Sign in"}
            </button>

            {msg && <p className={`modal-msg${ok ? " good" : ""}`}>{msg}</p>}

            <div className="modal-switch">
              {mode === "claim" ? (
                <>Already have an account?{" "}
                  <button className="link-btn2" onClick={() => { setMode("login"); setMsg(""); }}>Sign in</button></>
              ) : (
                <>New here?{" "}
                  <button className="link-btn2" onClick={() => { setMode("claim"); setMsg(""); }}>Create an account</button></>
              )}
            </div>
            <p className="modal-note">No email, no tracking. There is no reset in v1, so keep your passphrase safe.</p>
          </>
        )}
      </div>
    </div>
  );
}
