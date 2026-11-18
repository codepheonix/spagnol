"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "./api";
import { safeNext } from "@sm/security/redirect";

type Busy = { busy: boolean; err: string | null; ok: string | null };
function useAction() {
  const [s, set] = useState<Busy>({ busy: false, err: null, ok: null });
  const run = async (fn: () => Promise<string | void>) => {
    set({ busy: true, err: null, ok: null });
    try {
      const ok = await fn();
      set({ busy: false, err: null, ok: ok ?? null });
      return true;
    } catch (e) {
      set({ busy: false, err: (e as Error).message, ok: null });
      return false;
    }
  };
  return { ...s, run };
}
const Feedback = ({ s }: { s: Busy }) => (
  <>
    {s.err && <div className="msg err" role="alert">{s.err}</div>}
    {s.ok && <div className="msg ok" role="status">{s.ok}</div>}
  </>
);

export const PASSWORD_RULES = ["At least 12 characters — a few unrelated words work well.", "Not a common password, a keyboard run, or built from your name or e-mail.", "Not one this account has used before, and not one found in known data breaches."];

function NewPasswordFields({ value, confirm, onValue, onConfirm, idPrefix }: { value: string; confirm: string; onValue: (v: string) => void; onConfirm: (v: string) => void; idPrefix: string }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label htmlFor={`${idPrefix}-new`}>New password</label>
      <input id={`${idPrefix}-new`} type={show ? "text" : "password"} value={value} onChange={(e) => onValue(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required aria-describedby={`${idPrefix}-rules`} />
      <label htmlFor={`${idPrefix}-again`}>New password again</label>
      <input id={`${idPrefix}-again`} type={show ? "text" : "password"} value={confirm} onChange={(e) => onConfirm(e.target.value)} autoComplete="new-password" minLength={12} maxLength={200} required />
      <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show what I type</label>
      <ul id={`${idPrefix}-rules`} className="rules">{PASSWORD_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
    </>
  );
}

/** Password change. `forced` is the screen an account lands on when its password was exposed. */
export function PasswordChangeForm({ forced, next }: { forced: boolean; next: string }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const a = useAction();
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          if (pw !== again) throw new Error("The two new passwords do not match.");
          await api("/api/auth/password", { method: "POST", json: { currentPassword: current, newPassword: pw } });
          window.location.assign(safeNext(next, "/account/security?changed=1"));
        });
      }}
    >
      <h2 style={{ marginTop: 0 }}>{forced ? "Choose a new password" : "Change your password"}</h2>
      {forced && <div className="msg info">The password on this account was shared outside the app, so it can no longer be trusted. Choose a new one here. It is sent straight to the server over an encrypted connection and nobody else sees it.</div>}
      <label htmlFor="pc-current">Current password</label>
      <input id="pc-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
      <NewPasswordFields value={pw} confirm={again} onValue={setPw} onConfirm={setAgain} idPrefix="pc" />
      <Feedback s={a} />
      <button className="primary" disabled={a.busy} type="submit">{a.busy ? "Checking…" : "Save new password"}</button>
      <p className="small muted" style={{ marginBottom: 0 }}>Saving signs out every other browser that is using this account.</p>
    </form>
  );
}

function CodesBox({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `iGerald recovery codes\nEach code signs you in once if you lose your authenticator app.\n\n${codes.join("\n")}\n`;
  return (
    <div>
      <div className="msg info"><b>Save these recovery codes now.</b> They are shown this once and cannot be shown again. Each one signs you in a single time if you lose your phone.</div>
      <ol className="codes mono">{codes.map((c) => <li key={c}>{c}</li>)}</ol>
      <div className="row">
        <button type="button" className="btn" onClick={() => void navigator.clipboard?.writeText(text)}>Copy</button>
        <a className="btn" download="igerald-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>Download as a text file</a>
      </div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have stored these codes somewhere safe</label>
      <button type="button" className="primary" disabled={!saved} onClick={onDone} style={{ marginTop: 10 }}>Done</button>
    </div>
  );
}

const CodeInput = ({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) => (
  <input id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" required autoFocus={autoFocus} style={{ maxWidth: 160, letterSpacing: "0.2em" }} />
);

/** Two-factor sign-in: set up, new recovery codes, turn off. */
export function TwoFactorPanel({ enabled, enabledAt, codesLeft, deadline, overdue }: { enabled: boolean; enabledAt: string | null; codesLeft: number; deadline: string | null; overdue: boolean }) {
  const [mode, setMode] = useState<"idle" | "enrol" | "codes" | "regen" | "off">("idle");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const a = useAction();
  const reload = () => window.location.assign("/account/security");
  const reset = () => { setMode("idle"); setCode(""); setPassword(""); };

  if (mode === "codes") return <div className="card"><h2 style={{ marginTop: 0 }}>Two-factor sign-in is on</h2><CodesBox codes={codes} onDone={reload} /></div>;

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Two-factor sign-in</h2>
        <span className={`badge ${enabled ? "ok" : overdue ? "err" : "warn"}`}>{enabled ? "On" : "Off"}</span>
      </div>
      {!enabled && mode === "idle" && (
        <>
          <p>After your password, signing in also asks for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy or any other). A stolen password alone then opens nothing.</p>
          {overdue ? <div className="msg err">Two-factor sign-in is required on this account. The rest of iGerald opens again as soon as it is on.</div> : deadline ? <div className="msg info">Turn this on by <b>{deadline}</b>. After that date the rest of iGerald stays closed until it is on.</div> : null}
          <button className="primary" disabled={a.busy} onClick={() => void a.run(async () => { setSetup(await api("/api/account/mfa/start", { method: "POST" })); setMode("enrol"); })}>{a.busy ? "…" : "Set up two-factor sign-in"}</button>
          <Feedback s={a} />
        </>
      )}
      {!enabled && mode === "enrol" && setup && (
        <form onSubmit={(e) => { e.preventDefault(); void a.run(async () => { const r = await api<{ recoveryCodes: string[] }>("/api/account/mfa/confirm", { method: "POST", json: { code } }); setCodes(r.recoveryCodes); setSetup(null); setMode("codes"); }); }}>
          <ol className="steps">
            <li>Open your authenticator app and choose to add an account.</li>
            <li>
              Scan this code.
              {/* An image, not injected markup: nothing in it can run. */}
              <img className="qr" alt="QR code for your authenticator app" width={196} height={196} src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} />
              <details><summary className="small">Cannot scan? Type this key instead</summary><code className="mono secret">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code></details>
            </li>
            <li>
              <label htmlFor="tf-code" style={{ marginTop: 0 }}>Type the 6-digit code the app shows</label>
              <CodeInput id="tf-code" value={code} onChange={setCode} autoFocus />
            </li>
          </ol>
          <Feedback s={a} />
          <div className="row"><button className="primary" disabled={a.busy} type="submit">{a.busy ? "…" : "Turn on"}</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
        </form>
      )}
      {enabled && mode === "idle" && (
        <>
          <p>On since {enabledAt}. Signing in asks for a code from your authenticator app.</p>
          <p className={codesLeft <= 3 ? "msg info" : ""}>{codesLeft} of 10 recovery codes are unused.{codesLeft <= 3 ? " Make a new set before you run out." : ""}</p>
          <div className="row"><button className="btn" onClick={() => setMode("regen")}>Make new recovery codes</button><button className="btn danger" onClick={() => setMode("off")}>Turn off</button></div>
        </>
      )}
      {enabled && mode === "regen" && (
        <form onSubmit={(e) => { e.preventDefault(); void a.run(async () => { const r = await api<{ recoveryCodes: string[] }>("/api/account/mfa/recovery-codes", { method: "POST", json: { code } }); setCodes(r.recoveryCodes); setMode("codes"); }); }}>
          <p>New codes replace the old ones, which stop working at once.</p>
          <label htmlFor="rg-code">Current code from your authenticator app</label>
          <CodeInput id="rg-code" value={code} onChange={setCode} autoFocus />
          <Feedback s={a} />
          <div className="row"><button className="primary" disabled={a.busy} type="submit">Make new codes</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
        </form>
      )}
      {enabled && mode === "off" && (
        <form onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api("/api/account/mfa/disable", { method: "POST", json: { password, code } }); reload(); }); }}>
          <div className="msg err">Without two-factor sign-in the account is protected by its password alone. It must be set up again within 24 hours.</div>
          <label htmlFor="off-pw">Password</label>
          <input id="off-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
          <label htmlFor="off-code">Current code from your authenticator app</label>
          <CodeInput id="off-code" value={code} onChange={setCode} />
          <Feedback s={a} />
          <div className="row"><button className="btn danger" disabled={a.busy} type="submit">Turn off two-factor sign-in</button><button type="button" className="btn" onClick={reset}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

export interface SessionRow { id: string; current: boolean; device: string; ip: string | null; started: string; lastSeen: string; expires: string; secondFactor: boolean; waiting: boolean }

export function SessionsPanel({ sessions }: { sessions: SessionRow[] }) {
  const a = useAction();
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Where you are signed in</h2>
      <p className="muted small">A session ends after 12 hours without use and after 7 days at most.</p>
      <div className="scroll-x"><table>
        <thead><tr><th>Browser</th><th>Network address</th><th>Signed in</th><th>Last used</th><th /></tr></thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{s.device}{s.current && <span className="badge ok" style={{ marginLeft: 8 }}>This browser</span>}{s.waiting && <span className="badge warn" style={{ marginLeft: 8 }} title="The password was entered here but the two-factor code was not. This browser can open nothing.">Password only — not signed in</span>}</td>
              <td className="mono">{s.ip ?? "—"}</td>
              <td>{s.started}</td>
              <td>{s.lastSeen}</td>
              <td style={{ textAlign: "right" }}>{!s.current && <button className="btn small" disabled={a.busy} onClick={() => void a.run(async () => { await api(`/api/account/sessions/${s.id}`, { method: "DELETE" }); window.location.reload(); })}>Sign out</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <Feedback s={a} />
      <button className="btn" disabled={a.busy || others === 0} onClick={() => void a.run(async () => { await api("/api/account/sessions", { method: "DELETE" }); window.location.reload(); })}>{others === 0 ? "No other browser is signed in" : `Sign out the other ${others === 1 ? "browser" : `${others} browsers`}`}</button>
    </div>
  );
}

/** Asks for the password again before a change to keys, credentials or spending. */
export function ConfirmForm({ next, needsCode }: { next: string; needsCode: boolean }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const a = useAction();
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api("/api/account/reauth", { method: "POST", json: { password, code: needsCode ? code : undefined } }); window.location.assign(safeNext(next)); }); }}>
      <h2 style={{ marginTop: 0 }}>Confirm it is you</h2>
      <p>Changes to keys, credentials and ad spending need your password entered within the last ten minutes. After confirming, repeat the change you were making.</p>
      <label htmlFor="cf-pw">Password</label>
      <input id="cf-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus />
      {needsCode && (<><label htmlFor="cf-code">Code from your authenticator app</label><CodeInput id="cf-code" value={code} onChange={setCode} /></>)}
      <Feedback s={a} />
      <div className="row"><button className="primary" disabled={a.busy} type="submit">Confirm</button><Link className="btn" href={safeNext(next)}>Cancel</Link></div>
    </form>
  );
}

export function ForgotForm({ mail }: { mail: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const a = useAction();
  if (sent) {
    return (
      <div className="card">
        <h1>Check your inbox</h1>
        <p className="lead">If that address has an account, a link to choose a new password is on its way. The link works once, for 30 minutes.</p>
        <Link className="small" href="/login">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void a.run(async () => { await api("/api/auth/forgot", { method: "POST", json: { email } }); setSent(true); }); }}>
      <h1>Reset your password</h1>
      <p className="lead">Enter your account's e-mail address and we will send a link to choose a new password.</p>
      {!mail && <div className="msg info">This installation has no e-mail service connected yet, so no link can be sent. The owner can still recover the account with the procedure in docs/security/authentication.md.</div>}
      <label htmlFor="fg-email">Email</label>
      <input id="fg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
      <Feedback s={a} />
      <button className="primary" disabled={a.busy} type="submit">{a.busy ? "…" : "Send the link"}</button>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}><Link className="small" href="/login">Back to sign in</Link></div>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const a = useAction();
  if (done) return <div className="card"><h1>Password changed</h1><p className="lead">Every browser was signed out. Sign in with the new password.</p><Link className="btn primary" href="/login">Sign in</Link></div>;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(async () => {
          if (pw !== again) throw new Error("The two passwords do not match.");
          const proof = !needsCode ? {} : /^\d{6}$/.test(code.trim()) ? { code: code.trim() } : { recoveryCode: code };
          try {
            await api("/api/auth/reset", { method: "POST", json: { token, newPassword: pw, ...proof } });
            setDone(true);
          } catch (err) {
            if ((err as { code?: string }).code === "mfa_required" && !needsCode) {
              setNeedsCode(true);
              throw new Error("This account has two-factor sign-in. Enter a code from your authenticator app, or a recovery code, to finish.");
            }
            throw err;
          }
        });
      }}
    >
      <h1>Choose a new password</h1>
      <NewPasswordFields value={pw} confirm={again} onValue={setPw} onConfirm={setAgain} idPrefix="rs" />
      {needsCode && (<><label htmlFor="rs-code">Authenticator code or recovery code</label><input id="rs-code" className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" spellCheck={false} required autoFocus /></>)}
      <Feedback s={a} />
      <button className="primary" disabled={a.busy} type="submit">{a.busy ? "Checking…" : "Save new password"}</button>
    </form>
  );
}
