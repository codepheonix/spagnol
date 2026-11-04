"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Asset = { id: string; status: string; originalName: string; error?: string | null };

async function uploadOne(file: File, brandId: string, altText: string): Promise<Asset> {
  // Prefer browser-direct upload (signed URL); fall back to multipart through the server.
  const pre = await fetch("/api/media/presign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brandId, filename: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, altText: altText || null }) });
  const preData = await pre.json();
  if (!pre.ok) throw new Error(preData.error ?? pre.statusText);
  if (preData.uploadUrl) {
    const put = await fetch(preData.uploadUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    if (!put.ok) throw new Error(`Direct upload failed (${put.status}).`);
    const fin = await fetch(`/api/media/${preData.mediaId}/finalize`, { method: "POST" });
    const finData = await fin.json();
    if (!fin.ok) throw new Error(finData.error ?? fin.statusText);
    return finData.media as Asset;
  }
  const form = new FormData();
  form.set("brandId", brandId);
  form.set("file", file, file.name);
  if (altText) form.set("altText", altText);
  const res = await fetch("/api/media", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data.media[0] as Asset;
}

export function MediaUploader({ brandId }: { brandId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const formEl = e.currentTarget;
      const files = Array.from((formEl.elements.namedItem("file") as HTMLInputElement).files ?? []);
      const altText = (formEl.elements.namedItem("altText") as HTMLInputElement).value;
      if (!files.length) return;
      setBusy(true); setMsg(null);
      const results: string[] = [];
      for (const f of files) {
        try {
          const a = await uploadOne(f, brandId, altText);
          results.push(a.status === "ready" ? `${a.originalName}: ok` : `${a.originalName}: ${a.status} (${a.error ?? ""})`);
        } catch (err) {
          results.push(`${f.name}: ${(err as Error).message}`);
        }
      }
      setMsg(results.join(" · "));
      formEl.reset();
      setBusy(false);
      router.refresh();
    }}>
      <h3 style={{ marginTop: 0 }}>Upload</h3>
      <input type="file" name="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf" required />
      <label>Alt text (applied to each file)</label><input type="text" name="altText" />
      {msg && <div className="msg info">{msg}</div>}
      <div style={{ marginTop: 10 }}><button className="primary" disabled={busy} type="submit">{busy ? "Uploading…" : "Upload"}</button></div>
    </form>
  );
}
