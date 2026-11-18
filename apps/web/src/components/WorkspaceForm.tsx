"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

const KINDS: Array<{ id: "personal" | "business" | "client"; title: string; text: string }> = [
  { id: "personal", title: "Personal", text: "Your own social accounts." },
  { id: "business", title: "My company", text: "A company you own or work for." },
  { id: "client", title: "Client company", text: "A customer whose accounts you manage." },
];

/** Creates a workspace. Company details are optional and feed the AI drafts for that workspace only. */
export function WorkspaceForm({ defaultKind = "business", defaultLocale = "en" }: { defaultKind?: "personal" | "business" | "client"; defaultLocale?: "it" | "en" }) {
  const [f, setF] = useState({ kind: defaultKind, name: "", websiteUrl: "", industry: "", country: "", locale: defaultLocale, logoUrl: "", description: "", brandVoice: "", targetAudience: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const company = f.kind !== "personal";
  return (
    <form
      className="card"
      id="add"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        setBusy(true);
        try {
          const r = await api<{ brand: { id: string } }>("/api/brands", { method: "POST", json: company ? f : { kind: f.kind, name: f.name, locale: f.locale } });
          await api(`/api/brands/${r.brand.id}/select`, { method: "POST" });
          setF((cur) => ({ ...cur, name: "", websiteUrl: "", industry: "", country: "", logoUrl: "", description: "", brandVoice: "", targetAudience: "" }));
          router.push(`/organizations?created=${r.brand.id}`);
          router.refresh();
        } catch (e2) {
          setErr((e2 as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>Add a workspace</h2>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ marginBottom: 6 }}>Who is it for?</legend>
        <div className="kindpick">
          {KINDS.map((k) => (
            <label key={k.id}>
              <input type="radio" name="kind" value={k.id} checked={f.kind === k.id} onChange={() => setF({ ...f, kind: k.id })} />
              <b>{k.title}</b>
              {k.text}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="fields">
        <div className={company ? "" : "wide"}><label htmlFor="w-name">{company ? "Company name" : "Workspace name"}</label><input id="w-name" type="text" value={f.name} onChange={set("name")} required maxLength={80} placeholder={company ? "Company name" : "My accounts"} /></div>
        {company && <div><label htmlFor="w-web">Company website</label><input id="w-web" type="url" value={f.websiteUrl} onChange={set("websiteUrl")} placeholder="https://" /></div>}
        {company && <div><label htmlFor="w-ind">Industry</label><input id="w-ind" type="text" value={f.industry} onChange={set("industry")} maxLength={80} /></div>}
        {company && <div><label htmlFor="w-country">Country</label><input id="w-country" type="text" value={f.country} onChange={set("country")} maxLength={60} /></div>}
        <div><label htmlFor="w-lang">Language</label><select id="w-lang" value={f.locale} onChange={set("locale")}><option value="en">English</option><option value="it">Italiano</option></select></div>
        {company && <div><label htmlFor="w-logo">Logo image address</label><input id="w-logo" type="url" value={f.logoUrl} onChange={set("logoUrl")} placeholder="https://…/logo.png" /></div>}
        {company && <div className="wide"><label htmlFor="w-desc">Description</label><textarea id="w-desc" value={f.description} onChange={set("description")} maxLength={1000} placeholder="What the company does, in a sentence or two." /></div>}
        {company && <div><label htmlFor="w-voice">Brand voice</label><textarea id="w-voice" value={f.brandVoice} onChange={set("brandVoice")} maxLength={1000} placeholder="How it should sound when it writes." /></div>}
        {company && <div><label htmlFor="w-aud">Target audience</label><textarea id="w-aud" value={f.targetAudience} onChange={set("targetAudience")} maxLength={1000} placeholder="Who it is talking to." /></div>}
      </div>
      {err && <div className="msg err" role="alert">{err}</div>}
      <div style={{ marginTop: 14 }}><button className="primary" type="submit" disabled={busy}>{busy ? "Creating…" : company ? "Add company" : "Create personal workspace"}</button></div>
    </form>
  );
}
