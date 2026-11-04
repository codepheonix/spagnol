"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function MediaUploader({ brandId }: { brandId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      form.set("brandId", brandId);
      setBusy(true); setMsg(null);
      try {
        const res = await fetch("/api/media", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? res.statusText);
        const failed = (data.media as Array<{ status: string; originalName: string; error?: string }>).filter((m) => m.status !== "ready");
        setMsg(failed.length ? `Rejected: ${failed.map((f) => `${f.originalName} (${f.error})`).join("; ")}` : `Uploaded ${data.media.length} file(s).`);
        (e.target as HTMLFormElement).reset();
        router.refresh();
      } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); }
    }}>
      <h3 style={{ marginTop: 0 }}>Upload</h3>
      <input type="file" name="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf" required />
      <label>Alt text (applied to each file)</label><input type="text" name="altText" />
      {msg && <div className="msg info">{msg}</div>}
      <div style={{ marginTop: 10 }}><button className="primary" disabled={busy} type="submit">{busy ? "Uploading…" : "Upload"}</button></div>
    </form>
  );
}
