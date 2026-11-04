import Link from "next/link";
import { prisma } from "@sm/db";
import { zoneOffsetMinutes } from "@sm/core";
import { requireUser, requireBrand } from "@/lib/auth";
import { SlotEditor } from "@/components/SlotEditor";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const sp = await searchParams;
  const now = new Date();
  const [y, m] = (sp.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`).split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  const posts = await prisma.post.findMany({ where: { brandId: brand.id, OR: [{ scheduledAt: { gte: new Date(start.getTime() - 86_400_000), lt: new Date(end.getTime() + 86_400_000) } }, { publishedAt: { gte: start, lt: end } }] }, include: { targets: { select: { status: true, socialAccount: { select: { provider: true } } } } } });
  const slots = await prisma.scheduleSlot.findMany({ where: { brandId: brand.id }, include: { socialAccount: { select: { displayName: true } } }, orderBy: [{ weekday: "asc" }, { time: "asc" }] });
  const accounts = await prisma.socialAccount.findMany({ where: { brandId: brand.id, status: "connected" }, select: { id: true, displayName: true } });
  const days: Array<{ date: string; items: typeof posts }> = [];
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    const dateStr = d.toISOString().slice(0, 10);
    days.push({ date: dateStr, items: posts.filter((p) => { const at = p.scheduledAt ?? p.publishedAt; if (!at) return false; const local = new Date(at.getTime() + zoneOffsetMinutes(at, brand.timezone) * 60_000); return local.toISOString().slice(0, 10) === dateStr; }) });
  }
  const firstWeekday = (start.getUTCDay() + 6) % 7; // Monday first
  const prev = new Date(Date.UTC(y!, m! - 2, 1)), next = new Date(Date.UTC(y!, m!, 1));
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    <div>
      <h1>Calendar — {brand.name} <span className="small muted">({brand.timezone})</span></h1>
      <div className="row"><Link href={`/calendar?month=${fmt(prev)}`}>← {fmt(prev)}</Link><b>{y}-{String(m).padStart(2, "0")}</b><Link href={`/calendar?month=${fmt(next)}`}>{fmt(next)} →</Link></div>
      <div className="cal" style={{ marginTop: 10 }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="small muted">{d}</div>)}
        {Array.from({ length: firstWeekday }).map((_, i) => <div key={`e${i}`} />)}
        {days.map((d) => (<div key={d.date} className="day"><div className="d">{Number(d.date.slice(8))}</div>{d.items.map((p) => { const at = p.scheduledAt ?? p.publishedAt!; const local = new Date(at.getTime() + zoneOffsetMinutes(at, brand.timezone) * 60_000); return <div key={p.id}><Link href={`/posts/${p.id}`} className="small"><span className={`badge ${p.status}`}>{local.toISOString().slice(11, 16)}</span> {(p.title ?? p.body).slice(0, 24)}</Link></div>; })}</div>))}
      </div>
      <h2>Weekly queue slots</h2>
      <SlotEditor brandId={brand.id} timezone={brand.timezone} slots={slots.map((s) => ({ id: s.id, weekday: s.weekday, time: s.time, timezone: s.timezone, active: s.active, account: s.socialAccount?.displayName ?? null }))} accounts={accounts} />
    </div>
  );
}
