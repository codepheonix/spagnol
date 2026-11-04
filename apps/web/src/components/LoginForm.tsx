"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "./api";

export function LoginForm({ labels }: { labels: { email: string; password: string; login: string; title: string; lead: string } }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <form
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/api/auth/login", { method: "POST", json: { email, password } });
          router.push(sp.get("next") && sp.get("next")!.startsWith("/") ? sp.get("next")! : "/");
          router.refresh();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>{labels.title}</h1>
      <p className="lead">{labels.lead}</p>
      <label htmlFor="email">{labels.email}</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
      <label htmlFor="password">{labels.password}</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      {err && <div className="msg err">{err}</div>}
      <button className="primary" disabled={busy} type="submit">{busy ? "…" : labels.login}</button>
    </form>
  );
}

export function SetupForm({ claimEmail, lang }: { claimEmail?: string | null; lang: "it" | "en" }) {
  const [f, setF] = useState({ email: claimEmail ?? "", password: "", confirm: "", name: "", brandName: "Spagnol Mobili", setupToken: "" });
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
          await api("/api/auth/setup", { method: "POST", json: { email: f.email, password: f.password, name: f.name, brandName: f.brandName, setupToken: f.setupToken || undefined } });
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
      <label htmlFor="s-pw">{it ? "Password (minimo 10 caratteri)" : "Password (at least 10 characters)"}</label>
      <input id="s-pw" type="password" value={f.password} onChange={set("password")} minLength={10} autoComplete="new-password" required />
      <label htmlFor="s-pw2">{it ? "Ripeti la password" : "Repeat the password"}</label>
      <input id="s-pw2" type="password" value={f.confirm} onChange={set("confirm")} minLength={10} autoComplete="new-password" required />
      {!claimEmail && (
        <>
          <label htmlFor="s-brand">{it ? "Primo brand" : "First brand"}</label>
          <input id="s-brand" type="text" value={f.brandName} onChange={set("brandName")} required />
        </>
      )}
      {err && <div className="msg err">{err}</div>}
      <button className="primary" disabled={busy} type="submit">{claimEmail ? (it ? "Salva la password" : "Save password") : it ? "Crea account" : "Create owner"}</button>
    </form>
  );
}
