"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";
import { Action } from "./Action";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function SlotEditor({ brandId, timezone, slots, accounts }: { brandId: string; timezone: string; slots: Array<{ id: string; weekday: number; time: string; timezone: string; active: boolean; account: string | null }>; accounts: Array<{ id: string; displayName: string }> }) {
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("09:00");
  const [acct, setAcct] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="card">
      <table><thead><tr><th>Day</th><th>Time</th><th>Zone</th><th>Account</th><th>Active</th><th></th></tr></thead><tbody>
        {slots.map((s) => <tr key={s.id}><td>{DAYS[s.weekday]}</td><td>{s.time}</td><td>{s.timezone}</td><td>{s.account ?? "all"}</td><td><Action path={`/api/queues/${s.id}`} method="PATCH" json={{ active: !s.active }} label={s.active ? "pause" : "resume"} /></td><td><Action className="danger" path={`/api/queues/${s.id}`} method="DELETE" label="remove" /></td></tr>)}
        {slots.length === 0 && <tr><td colSpan={6} className="muted">No slots. Add weekly posting times below; “next free slot” fills them in order.</td></tr>}
      </tbody></table>
      <div className="row" style={{ marginTop: 8 }}>
        <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} style={{ width: 90 }}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 110 }} />
        <select value={acct} onChange={(e) => setAcct(e.target.value)} style={{ width: 200 }}><option value="">all accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select>
        <button onClick={async () => { setErr(null); try { await api("/api/queues", { method: "POST", json: { brandId, weekday, time, timezone, socialAccountId: acct || null } }); router.refresh(); } catch (e) { setErr((e as Error).message); } }}>Add slot</button>
        <button onClick={async () => { const r = await api<{ next: string | null }>(`/api/queues/next-slot?brandId=${brandId}`); setNext(r.next ? new Date(r.next).toLocaleString("it-IT", { timeZone: timezone }) : "none"); }}>Next free slot</button>
        {next && <span className="small">→ {next}</span>}
      </div>
      {err && <div className="msg err">{err}</div>}
    </div>
  );
}
