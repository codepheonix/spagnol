"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string };
export type Descriptor = { id: string; backend: "native" | "zernio"; displayName: string; connect: { kind: "oauth" | "credentials" | "gateway"; fields?: Field[]; notes?: string }; implementationStatus: string; missingEnv: string[]; capabilities: Record<string, string>; docsUrl?: string };

export function ConnectPanel({ brandId, providers, zernioConfigured }: { brandId: string; providers: Descriptor[]; zernioConfigured: boolean }) {
  const [sel, setSel] = useState<string>("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loginMethod, setLoginMethod] = useState<"facebook_login" | "instagram_login">("facebook_login");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const d = providers.find((p) => `${p.id}:${p.backend}` === sel);
  const usable = (p: Descriptor) => p.implementationStatus !== "NOT_IMPLEMENTED" && p.missingEnv.length === 0 && !(p.backend === "zernio" && !zernioConfigured);
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Connect an account</h3>
      <label>Provider</label>
      <select value={sel} onChange={(e) => { setSel(e.target.value); setFields({}); setErr(null); }}>
        <option value="">— choose —</option>
        {providers.map((p) => (<option key={`${p.id}:${p.backend}`} value={`${p.id}:${p.backend}`} disabled={!usable(p)}>{p.displayName}{!usable(p) ? ` — ${p.backend === "zernio" && !zernioConfigured ? "add Zernio key in Settings" : p.missingEnv.length ? `needs ${p.missingEnv.join(", ")}` : "not implemented"}` : ""}</option>))}
      </select>
      {d && (
        <div style={{ marginTop: 10 }}>
          {d.connect.notes && <p className="small muted">{d.connect.notes}</p>}
          {d.connect.kind === "credentials" && d.connect.fields?.map((f) => (
            <div key={f.name}><label>{f.label}</label><input type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={fields[f.name] ?? ""} onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })} autoComplete="off" />{f.help && <div className="small muted">{f.help}</div>}</div>
          ))}
          {d.id === "instagram" && d.backend === "zernio" && (
            <div><label>Login method</label><select value={loginMethod} onChange={(e) => setLoginMethod(e.target.value as "facebook_login")}><option value="facebook_login">Facebook Login (needed for ads + full features)</option><option value="instagram_login">Instagram Login (posting only)</option></select></div>
          )}
          {err && <div className="msg err">{err}</div>}
          <div style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={async () => {
              setBusy(true); setErr(null);
              try {
                if (d.connect.kind === "credentials") {
                  await api("/api/connections/credentials", { method: "POST", json: { brandId, provider: d.id, fields } });
                  setFields({}); setSel(""); router.refresh();
                } else {
                  const r = await api<{ redirectUrl: string | null }>(`/api/brands/${brandId}/connections/${d.id}/start`, { method: "POST", json: { backend: d.backend, options: d.id === "instagram" ? { loginMethod } : {} } });
                  if (r.redirectUrl) window.location.href = r.redirectUrl;
                }
              } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
            }}>{d.connect.kind === "credentials" ? "Connect" : "Continue to " + (d.backend === "zernio" ? "Zernio" : d.displayName)}</button>
          </div>
        </div>
      )}
    </div>
  );
}
