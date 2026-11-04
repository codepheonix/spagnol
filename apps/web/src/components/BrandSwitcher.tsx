"use client";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function BrandSwitcher({ brands, activeId }: { brands: Array<{ id: string; name: string }>; activeId: string | null }) {
  const router = useRouter();
  return (
    <select value={activeId ?? ""} onChange={async (e) => { await api(`/api/brands/${e.target.value}/select`, { method: "POST" }); router.refresh(); }}>
      {brands.map((b) => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
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
