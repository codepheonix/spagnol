"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "./api";
import { safeNext } from "@sm/security/redirect";

/** Sign-in: password first, then the authenticator code when the account has two-factor sign-in. */
export function LoginForm({ labels }: { labels: { email: string; password: string; login: string; title: string; lead: string } }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sp = useSearchParams();
  // A full navigation, so the next page is rendered with the new session and nothing cached from before.
  const enter = () => window.location.assign(safeNext(sp.get("next")));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  if (step === "code") {
    return (
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api("/api/auth/mfa", { method: "POST", json: useRecovery ? { recoveryCode: code } : { code } });
            enter();
          });
        }}
      >
        <h1>Two-factor sign-in</h1>
        <p className="lead">{useRecovery ? "Enter one of your recovery codes. Each code works once." : "Enter the 6-digit code from your authenticator app."}</p>
        <label htmlFor="code">{useRecovery ? "Recovery code" : "Code"}</label>
        {useRecovery ? (
          <input id="code" key="r" className="mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" required autoFocus />
        ) : (
          <input id="code" key="t" className="mono" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" placeholder="000000" required autoFocus />
        )}
        {err && <div className="msg err" role="alert">{err}</div>}
        <button className="primary" disabled={busy} type="submit">{busy ? "…" : "Sign in"}</button>
        <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <button type="button" className="linklike" onClick={() => { setUseRecovery(!useRecovery); setCode(""); setErr(null); }}>{useRecovery ? "Use the authenticator app" : "Use a recovery code"}</button>
          <button type="button" className="linklike" onClick={() => { setStep("password"); setCode(""); setPassword(""); setErr(null); }}>Start again</button>
        </div>
      </form>
    );
  }
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api<{ secondFactor?: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
          if (r.secondFactor) {
            setStep("code");
            setBusy(false);
          } else enter();
        });
      }}
    >
      <h1>{labels.title}</h1>
      <p className="lead">{labels.lead}</p>
      <label htmlFor="email">{labels.email}</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
      <label htmlFor="password">{labels.password}</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      {err && <div className="msg err" role="alert">{err}</div>}
      <button className="primary" disabled={busy} type="submit">{busy ? "…" : labels.login}</button>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        <Link className="small" href="/forgot">Forgot your password?</Link>
      </div>
    </form>
  );
}

export function SetupForm({ claimEmail, lang }: { claimEmail?: string | null; lang: "it" | "en" }) {
  const [f, setF] = useState({ email: claimEmail ?? "", password: "", confirm: "", name: "", setupToken: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const it = lang === "it";
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        if (f.password !== f.confirm) {
          setErr(it ? "Le due password non coincidono." : "The two passwords do not match.");
          return;
        }
        setBusy(true);
        try {
          await api("/api/auth/setup", { method: "POST", json: { email: f.email, password: f.password, name: f.name, setupToken: f.setupToken || undefined } });
          router.push("/login");
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>{claimEmail ? (it ? "Scegli la password" : "Choose your password") : it ? "Primo accesso" : "First-run setup"}</h1>
      <p className="lead">{claimEmail ? (it ? `L'account ${claimEmail} è riservato a te. Imposta la password: questa pagina poi scompare.` : `The account ${claimEmail} is reserved for you. Set its password; this page disappears afterwards.`) : it ? "Crea l'unico account titolare." : "Create the single owner account."}</p>
      <label htmlFor="s-email">Email</label>
      <input id="s-email" type="email" value={f.email} onChange={set("email")} required readOnly={Boolean(claimEmail)} />
      <label htmlFor="s-name">{it ? "Nome" : "Name"}</label>
      <input id="s-name" type="text" value={f.name} onChange={set("name")} autoFocus />
      <label htmlFor="s-pw">{it ? "Password (almeno 12 caratteri, non una parola comune)" : "Password (at least 12 characters, not a common word)"}</label>
      <input id="s-pw" type="password" value={f.password} onChange={set("password")} minLength={12} autoComplete="new-password" required />
      <label htmlFor="s-pw2">{it ? "Ripeti la password" : "Repeat the password"}</label>
      <input id="s-pw2" type="password" value={f.confirm} onChange={set("confirm")} minLength={12} autoComplete="new-password" required />
      {err && <div className="msg err">{err}</div>}
      <button className="primary" disabled={busy} type="submit">{claimEmail ? (it ? "Salva la password" : "Save password") : it ? "Crea account" : "Create owner"}</button>
    </form>
  );
}
