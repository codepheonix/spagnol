"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "./api";

export function LoginForm({ labels }: { labels: { email: string; password: string; login: string } }) {
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
      <label>{labels.email}</label>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      <label>{labels.password}</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      {err && <div className="msg err">{err}</div>}
      <div style={{ marginTop: 12 }}>
        <button className="primary" disabled={busy} type="submit">{labels.login}</button>
      </div>
    </form>
  );
}

export function SetupForm({ claimEmail }: { claimEmail?: string | null }) {
  const [f, setF] = useState({ email: claimEmail ?? "", password: "", name: "", brandName: "Spagnol Mobili", setupToken: "" });
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api("/api/auth/setup", { method: "POST", json: f }); router.push("/login"); } catch (e2) { setErr((e2 as Error).message); } }}>
      <label>Owner email</label><input type="email" value={f.email} onChange={set("email")} required readOnly={Boolean(claimEmail)} />
      <label>Password (min 10 characters)</label><input type="password" value={f.password} onChange={set("password")} minLength={10} required />
      <label>Name</label><input type="text" value={f.name} onChange={set("name")} />
      {!claimEmail && <><label>First brand</label><input type="text" value={f.brandName} onChange={set("brandName")} required /></>}
      <label>Setup token (only if configured)</label><input type="password" value={f.setupToken} onChange={set("setupToken")} />
      {err && <div className="msg err">{err}</div>}
      <div style={{ marginTop: 12 }}><button className="primary" type="submit">{claimEmail ? "Set password" : "Create owner"}</button></div>
    </form>
  );
}
