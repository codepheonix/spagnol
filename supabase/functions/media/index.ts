// Supabase Edge Function "media": private-bucket storage gateway for the social manager.
// Authenticated with a shared secret (MEDIA_GATEWAY_SECRET env in the app; MEDIA_SECRET here).
// The service-role key never leaves Supabase. Deployed with verify_jwt=false (own auth).
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = Deno.env.get("MEDIA_BUCKET") ?? "media";
const SECRET = Deno.env.get("MEDIA_SECRET") ?? "__MEDIA_SECRET__";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  const given = req.headers.get("x-media-secret") ?? "";
  if (!timingSafeEqual(given, SECRET)) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const action = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const key = url.searchParams.get("key") ?? "";
  if (!key && action !== "health") return json({ error: "key required" }, 400);
  try {
    if (action === "health") return json({ ok: true, bucket: BUCKET });
    if (req.method === "PUT" && action === "object") {
      const contentType = req.headers.get("content-type") ?? "application/octet-stream";
      const body = new Uint8Array(await req.arrayBuffer());
      const { error } = await supabase.storage.from(BUCKET).upload(key, body, { contentType, upsert: true });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, size: body.length });
    }
    if (req.method === "GET" && action === "object") {
      const { data, error } = await supabase.storage.from(BUCKET).download(key);
      if (error || !data) return json({ error: error?.message ?? "not found" }, 404);
      return new Response(data, { headers: { "content-type": data.type || "application/octet-stream" } });
    }
    if (req.method === "GET" && action === "head") {
      const dir = key.split("/").slice(0, -1).join("/");
      const name = key.split("/").pop()!;
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
      if (error) return json({ error: error.message }, 500);
      return json({ exists: (data ?? []).some((f) => f.name === name) });
    }
    if (req.method === "DELETE" && action === "object") {
      const { error } = await supabase.storage.from(BUCKET).remove([key]);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }
    if (req.method === "POST" && action === "sign-read") {
      const ttl = Number(url.searchParams.get("ttl") ?? 3600);
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, ttl);
      if (error || !data) return json({ error: error?.message ?? "sign failed" }, 500);
      return json({ url: data.signedUrl });
    }
    if (req.method === "POST" && action === "sign-upload") {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(key, { upsert: true });
      if (error || !data) return json({ error: error?.message ?? "sign failed" }, 500);
      return json({ url: data.signedUrl, token: data.token, path: data.path });
    }
    return json({ error: `unknown action ${req.method} ${action}` }, 404);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
