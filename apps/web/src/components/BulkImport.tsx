"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Row = { line: number; body: string; accounts: string[]; scheduledAt?: string; errors: string[] };

export function BulkImport({ brandId, timezone }: { brandId: string; timezone: string }) {
  const [csv, setCsv] = useState("body,accounts,date,time,link\n");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <details className="card"><summary>Bulk import (CSV)</summary>
      <p className="small muted">Columns: <code>body, accounts, date, time, link</code>. <code>accounts</code> = account display names or ids separated by “;”. Dates are local {timezone}. Dry-run first; nothing is created until you commit.</p>
      <textarea value={csv} onChange={(e) => setCsv(e.target.value)} style={{ minHeight: 140, fontFamily: "monospace" }} />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={async () => { setMsg(null); try { const r = await api<{ rows: Row[] }>("/api/posts/bulk/validate", { method: "POST", json: { brandId, csv, timezone } }); setRows(r.rows); } catch (e) { setMsg((e as Error).message); } }}>Dry run</button>
        <button className="primary" disabled={!rows || rows.some((r) => r.errors.length) || !rows.length} onClick={async () => { setMsg(null); try { const r = await api<{ created: string[] }>("/api/posts/bulk/commit", { method: "POST", json: { brandId, csv, timezone } }); setMsg(`Created ${r.created.length} posts.`); setRows(null); router.refresh(); } catch (e) { setMsg((e as Error).message); } }}>Commit</button>
      </div>
      {msg && <div className="msg info">{msg}</div>}
      {rows && <table><thead><tr><th>Line</th><th>Text</th><th>Accounts</th><th>Scheduled (UTC)</th><th>Errors</th></tr></thead><tbody>{rows.map((r) => <tr key={r.line}><td>{r.line}</td><td className="small">{r.body.slice(0, 60)}</td><td className="small">{r.accounts.length}</td><td className="small">{r.scheduledAt ?? "—"}</td><td className="small" style={{ color: r.errors.length ? "var(--err)" : "var(--ok)" }}>{r.errors.join("; ") || "ok"}</td></tr>)}</tbody></table>}
    </details>
  );
}
