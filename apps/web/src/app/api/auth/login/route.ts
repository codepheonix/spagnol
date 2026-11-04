import { z } from "zod";
import { cookies, headers } from "next/headers";
import { handle, json, parseJson } from "@/lib/api";
import { login, SESSION_COOKIE, sessionCookieOptions, clientIp } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
const attempts = new Map<string, { n: number; until: number }>();

export const POST = handle(async (req) => {
  const ip = (await clientIp()) ?? "local";
  const a = attempts.get(ip);
  if (a && a.n >= 8 && a.until > Date.now()) return json({ error: "Too many attempts. Try again in a few minutes.", code: "rate_limited" }, { status: 429 });
  const { email, password } = await parseJson(req, schema);
  const h = await headers();
  const r = await login(email, password, { userAgent: h.get("user-agent"), ip });
  if (!r.ok) {
    attempts.set(ip, { n: (a?.n ?? 0) + 1, until: Date.now() + 10 * 60_000 });
    return json({ error: "Invalid email or password.", code: r.error }, { status: 401 });
  }
  attempts.delete(ip);
  (await cookies()).set(SESSION_COOKIE, r.token, sessionCookieOptions());
  return json({ ok: true });
});
