import { prisma } from "@sm/db";
import { formatInZone } from "@sm/core";
import { requireUser } from "@/lib/auth";

export default async function ActivityPage() {
  const user = await requireUser();
  const logs = await prisma.auditLog.findMany({ where: { OR: [{ actorUserId: user.id }, { brand: { ownerId: user.id } }, { actorUserId: null }] }, orderBy: { createdAt: "desc" }, take: 200, include: { brand: { select: { name: true } } } });
  return (
    <div>
      <h1>Activity</h1>
      <table><thead><tr><th>When</th><th>Brand</th><th>Action</th><th>Target</th><th>Outcome</th><th>Details</th></tr></thead><tbody>
        {logs.map((l) => <tr key={l.id}><td className="small muted">{formatInZone(l.createdAt, user.timezone)}</td><td className="small">{l.brand?.name ?? "—"}</td><td className="mono small">{l.action}</td><td className="mono small">{l.targetType ? `${l.targetType}:${l.targetId}` : ""}</td><td><span className={`badge ${l.outcome === "ok" ? "ok" : "err"}`}>{l.outcome}</span></td><td className="small muted">{JSON.stringify(l.details).slice(0, 140)}</td></tr>)}
      </tbody></table>
    </div>
  );
}
