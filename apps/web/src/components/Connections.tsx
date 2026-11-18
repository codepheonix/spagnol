"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Field = { name: string; label: string; secret?: boolean; placeholder?: string; help?: string };

/**
 * Opens the platform's own sign-in page for this brand. If the one-time app registration is
 * missing, it goes to the setup page instead of failing.
 */
export function ConnectButton({ brandId, provider, backend = "native", loginMethod, reconnectAccountId, label, className = "primary small", setupHref }: { brandId: string; provider: string; backend?: "native" | "zernio"; loginMethod?: string; reconnectAccountId?: string; label: string; className?: string; setupHref?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await api<{ redirectUrl: string | null }>(`/api/brands/${brandId}/connections/${provider}/start`, { method: "POST", json: { backend, options: loginMethod ? { loginMethod } : {}, reconnectAccountId } });
            if (r.redirectUrl) window.location.href = r.redirectUrl;
            else setBusy(false);
          } catch (e) {
            const code = (e as { code?: string }).code;
            if (code === "provider_app_missing" && setupHref) router.push(setupHref);
            else setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? "Opening…" : label}
      </button>
      {err && <div className="small" style={{ color: "var(--err)", marginTop: 4, maxWidth: 360 }}>{err}</div>}
    </span>
  );
}

/** Networks whose documented connection is a bot token / app password: a small inline form. */
export function CredentialsConnect({ brandId, provider, fields, notes, startOpen }: { brandId: string; provider: string; fields: Field[]; notes?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(startOpen));
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  if (!open) return <button className="small" onClick={() => setOpen(true)}>Connect</button>;
  return (
    <div style={{ minWidth: 280 }}>
      {notes && <p className="small muted" style={{ marginTop: 0 }}>{notes}</p>}
      {fields.map((f) => (
        <div key={f.name}>
          <label>{f.label}</label>
          <input type={f.secret ? "password" : "text"} placeholder={f.placeholder} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} autoComplete="off" />
          {f.help && <div className="small muted">{f.help}</div>}
        </div>
      ))}
      {err && <div className="msg err">{err}</div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="primary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api("/api/connections/credentials", { method: "POST", json: { brandId, provider, fields: values } });
              setValues({});
              setOpen(false);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
        <button className="ghost small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export type ChooserOption = { key: string; provider: string; displayName: string; username?: string | null; avatarUrl?: string | null; profileUrl?: string | null; linkedTo?: string | null; alreadyConnected: boolean; otherBrands: string[]; requested: boolean };

/** After sign-in: pick exactly which Pages / Instagram accounts belong to this brand. */
export function AccountChooser({ state, brandName, options, providerNames }: { state: string; brandName: string; options: ChooserOption[]; providerNames: Record<string, string> }) {
  const requested = options.filter((o) => o.requested);
  const [picked, setPicked] = useState<string[]>(requested.length === 1 ? [requested[0]!.key] : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const groups = [...new Set(options.map((o) => o.provider))];
  return (
    <div>
      {groups.map((g) => (
        <div className="card" key={g}>
          <h3 style={{ marginTop: 0 }}>{providerNames[g] ?? g}</h3>
          {options.filter((o) => o.provider === g).map((o) => (
            <label key={o.key} className="row" style={{ padding: "8px 0", borderTop: "1px solid var(--line)", cursor: "pointer", flexWrap: "nowrap" }}>
              <input type="checkbox" checked={picked.includes(o.key)} onChange={() => toggle(o.key)} style={{ width: "auto" }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {o.avatarUrl ? <img src={o.avatarUrl} alt="" width={36} height={36} style={{ borderRadius: 999 }} referrerPolicy="no-referrer" /> : <span style={{ width: 36, height: 36, borderRadius: 999, background: "var(--surface-2)", display: "inline-block" }} />}
              <span style={{ flex: 1 }}>
                <b>{o.displayName}</b>
                {o.username && <span className="muted"> @{o.username}</span>}
                <div className="small muted">
                  {o.linkedTo && <span>{g === "instagram" ? `Linked to the Page “${o.linkedTo}”` : `Instagram linked: ${o.linkedTo}`} · </span>}
                  {o.alreadyConnected ? `Already connected to ${brandName} — ticking it refreshes the permission` : o.otherBrands.length ? `Also connected to: ${o.otherBrands.join(", ")}` : "Not connected yet"}
                </div>
              </span>
            </label>
          ))}
        </div>
      ))}
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button
          className="primary"
          disabled={busy || !picked.length}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await api<{ accounts: unknown[] }>("/api/connections/pending", { method: "POST", json: { state, keys: picked } });
              router.push(`/connections?connected=${r.accounts.length}`);
              router.refresh();
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Connecting…" : `Connect ${picked.length || ""} to ${brandName}`}
        </button>
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            await api(`/api/connections/pending?state=${encodeURIComponent(state)}`, { method: "DELETE" }).catch(() => null);
            router.push("/connections");
          }}
        >
          Cancel — connect nothing
        </button>
      </div>
    </div>
  );
}

/** One-time Meta app registration values. Secrets are write-only: the page only learns "configured". */
export function MetaSetupForm({ configured }: { configured: { meta: boolean; configId: boolean; extended: boolean; instagram: boolean } }) {
  const [f, setF] = useState({ metaAppId: "", metaAppSecret: "", metaLoginConfigId: "", instagramAppId: "", instagramAppSecret: "" });
  const [extended, setExtended] = useState(configured.extended);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const post = async (json: Record<string, unknown>, done: (r: { metaAppName?: string | null }) => string) => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await api<{ metaAppName?: string | null }>("/api/settings/provider-apps", { method: "POST", json });
      setMsg(done(r));
      setF({ metaAppId: "", metaAppSecret: "", metaLoginConfigId: "", instagramAppId: "", instagramAppSecret: "" });
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Meta app {configured.meta ? <span className="badge ok">saved</span> : <span className="badge warn">not set yet</span>}</h3>
        <p className="small muted">Checked with Meta when you press Save, then stored encrypted on the server. It is never shown again and never sent to the browser.</p>
        <label>App ID</label>
        <input type="text" inputMode="numeric" autoComplete="off" value={f.metaAppId} onChange={(e) => setF({ ...f, metaAppId: e.target.value })} placeholder={configured.meta ? "saved — enter a new one to replace it" : "e.g. 1234567890123456"} />
        <label>App secret</label>
        <input type="password" autoComplete="off" value={f.metaAppSecret} onChange={(e) => setF({ ...f, metaAppSecret: e.target.value })} placeholder={configured.meta ? "••••••••" : ""} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || !f.metaAppId || !f.metaAppSecret} onClick={() => post({ metaAppId: f.metaAppId, metaAppSecret: f.metaAppSecret }, (r) => `Meta accepted the App ID and secret${r.metaAppName ? ` for “${r.metaAppName}”` : ""}. Facebook and Instagram can now be connected.`)}>Check with Meta and save</button>
          {configured.meta && <button className="danger" disabled={busy} onClick={() => { if (window.confirm("Remove the saved Meta app ID and secret? Connected accounts keep working until their permission needs renewing.")) void post({ clear: "meta" }, () => "Removed."); }}>Remove</button>}
        </div>
      </div>
      <details className="card">
        <summary><b>Optional settings</b> <span className="small muted">— only if you need them</span></summary>
        <label style={{ marginTop: 12 }} className="row"><input type="checkbox" style={{ width: "auto" }} checked={extended} onChange={(e) => { setExtended(e.target.checked); void post({ metaExtendedScopes: e.target.checked }, () => (e.target.checked ? "Sign-in will now also ask for the comments and insights permissions. Reconnect accounts to grant them." : "Sign-in asks for the publishing permissions only.")); }} /> Also ask for comments and insights permissions at sign-in</label>
        <p className="small muted">Turn this on only after adding these to the Meta app (otherwise Meta rejects the sign-in): <span className="mono">pages_read_user_content, pages_manage_engagement, read_insights, instagram_manage_comments, instagram_manage_insights</span>.</p>
        <label>Facebook Login for Business — Configuration ID {configured.configId && <span className="badge ok">saved</span>}</label>
        <input type="text" autoComplete="off" value={f.metaLoginConfigId} onChange={(e) => setF({ ...f, metaLoginConfigId: e.target.value })} placeholder="only if Meta's sign-in asks for a configuration" />
        <div className="row" style={{ marginTop: 8 }}><button disabled={busy} onClick={() => post({ metaLoginConfigId: f.metaLoginConfigId }, () => (f.metaLoginConfigId ? "Configuration ID saved." : "Configuration ID cleared."))}>Save configuration ID</button></div>
        <h4>Instagram login (without a Facebook Page) {configured.instagram ? <span className="badge ok">saved</span> : <span className="badge">not set</span>}</h4>
        <p className="small muted">Meta allows one Instagram setup per app. The app above uses “API setup with Facebook Login”; signing in on Instagram directly needs a second Meta app created with “API setup with Instagram Login”. Its Instagram app ID and secret go here.</p>
        <label>Instagram app ID</label>
        <input type="text" autoComplete="off" value={f.instagramAppId} onChange={(e) => setF({ ...f, instagramAppId: e.target.value })} />
        <label>Instagram app secret</label>
        <input type="password" autoComplete="off" value={f.instagramAppSecret} onChange={(e) => setF({ ...f, instagramAppSecret: e.target.value })} />
        <div className="row" style={{ marginTop: 8 }}>
          <button disabled={busy || !f.instagramAppId || !f.instagramAppSecret} onClick={() => post({ instagramAppId: f.instagramAppId, instagramAppSecret: f.instagramAppSecret }, () => "Instagram login values saved. They are checked on the first sign-in.")}>Save Instagram login</button>
          {configured.instagram && <button className="danger" disabled={busy} onClick={() => void post({ clear: "instagram" }, () => "Removed.")}>Remove</button>}
        </div>
      </details>
      {msg && <div className="msg ok">{msg}</div>}
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}
