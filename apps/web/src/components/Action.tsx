"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

/** Button that calls an API endpoint and refreshes the page; shows the server's error verbatim. */
export function Action({ path, method = "POST", json, label, confirm: confirmText, className, onDone, redirect }: { path: string; method?: "POST" | "PATCH" | "DELETE"; json?: unknown; label: string; confirm?: string; className?: string; onDone?: (data: unknown) => void; redirect?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span>
      <button
        className={className}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          setErr(null);
          try {
            const data = await api(path, { method, json });
            onDone?.(data);
            if (redirect) router.push(redirect);
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "…" : label}
      </button>
      {err && <span className="small" style={{ color: "var(--err)", marginLeft: 6 }}>{err}</span>}
    </span>
  );
}
