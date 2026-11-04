import { prisma } from "@sm/db";
import { requireUser, requireBrand } from "@/lib/auth";
import { MediaUploader } from "@/components/MediaUploader";
import { Action } from "@/components/Action";

export default async function MediaPage() {
  const user = await requireUser();
  const brand = await requireBrand(user);
  const media = await prisma.mediaAsset.findMany({ where: { brandId: brand.id }, orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { postMedia: true } } } });
  return (
    <div>
      <h1>Media — {brand.name}</h1>
      <p className="muted small">Files are stored privately ({process.env.STORAGE_DRIVER ?? "local"} driver), validated by content, and never attached to a post until <b>ready</b>.</p>
      <MediaUploader brandId={brand.id} />
      <table><thead><tr><th></th><th>File</th><th>Type</th><th>Size</th><th>Dimensions</th><th>Status</th><th>Used</th><th></th></tr></thead><tbody>
        {media.map((m) => (<tr key={m.id}><td>{m.mimeType.startsWith("image/") && m.status === "ready" ? <img className="thumb" src={`/api/media/${m.id}`} alt={m.altText ?? ""} /> : <span className="badge">{m.mimeType.split("/")[0]}</span>}</td><td>{m.originalName}<div className="small muted">{m.altText}</div></td><td className="small">{m.mimeType}</td><td className="small">{(m.sizeBytes / 1024 / 1024).toFixed(2)} MB</td><td className="small">{m.width ? `${m.width}×${m.height}` : "—"}</td><td><span className={`badge ${m.status === "ready" ? "ok" : m.status === "failed" ? "err" : "warn"}`}>{m.status}</span>{m.error && <div className="small" style={{ color: "var(--err)" }}>{m.error}</div>}</td><td>{m._count.postMedia}</td><td>{m._count.postMedia === 0 && <Action className="danger" path={`/api/media/${m.id}`} method="DELETE" label="Delete" confirm="Delete this file?" />}</td></tr>))}
        {media.length === 0 && <tr><td colSpan={8} className="muted">No media yet.</td></tr>}
      </tbody></table>
    </div>
  );
}
