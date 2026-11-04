"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function ReplyBox({ path, placeholder }: { path: string; placeholder?: string }) {
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="row">
      <input type="text" value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder ?? "Reply…"} style={{ width: 320 }} />
      <button disabled={busy || !body.trim()} onClick={async () => { setBusy(true); setErr(null); try { await api(path, { method: "POST", json: { body } }); setBody(""); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>Send</button>
      {err && <span className="small" style={{ color: "var(--err)" }}>{err}</span>}
    </div>
  );
}
