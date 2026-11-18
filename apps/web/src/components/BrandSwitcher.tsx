"use client";
import { useRouter } from "next/navigation";
import { api } from "./api";

const GROUPS: Array<[string, string]> = [["personal", "Personal"], ["business", "Companies"], ["client", "Client companies"]];

/** Switches the workspace everything else on screen belongs to. */
export function BrandSwitcher({ brands, activeId }: { brands: Array<{ id: string; name: string; kind?: string }>; activeId: string | null }) {
  const router = useRouter();
  if (brands.length === 0) return <a className="chip" href="/organizations?first=1">Create a workspace</a>;
  return (
    <select aria-label="Current workspace" value={activeId ?? ""} onChange={async (e) => { await api(`/api/brands/${e.target.value}/select`, { method: "POST" }); router.refresh(); }}>
      {GROUPS.map(([kind, label]) => {
        const items = brands.filter((b) => (b.kind ?? "business") === kind);
        return items.length ? (
          <optgroup key={kind} label={label}>
            {items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function LocaleToggle({ locale }: { locale: string }) {
  const router = useRouter();
  return (
    <button className="small" onClick={async () => { await api("/api/settings", { method: "POST", json: { locale: locale === "it" ? "en" : "it" } }); router.refresh(); }}>
      {locale === "it" ? "EN" : "IT"}
    </button>
  );
}

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return <button className="small" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>{label}</button>;
}
