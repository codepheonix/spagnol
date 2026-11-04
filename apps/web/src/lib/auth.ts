import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, type Brand, type User } from "@sm/db";
import { hashPassword, randomToken, sha256Hex, signSessionToken, verifyPassword, verifySessionToken } from "@sm/security";
import { audit } from "@sm/core";

export const SESSION_COOKIE = "sm_session";
export const BRAND_COOKIE = "sm_brand";
export const LOCALE_COOKIE = "sm_locale";
const SESSION_TTL = 60 * 60 * 24 * 14; // 14 days

export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  if (!session || session.userId !== claims.sub || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function login(email: string, password: string, meta: { userAgent?: string | null; ip?: string | null }): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Constant-time-ish: always run a hash verify even if the user is missing.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, await hashPassword("dummy-password-x")).then(() => false);
  if (!user || !ok) {
    await audit({ action: "auth.login", outcome: "denied", details: { email: email.trim().toLowerCase() }, ip: meta.ip });
    return { ok: false, error: "invalid_credentials" };
  }
  const raw = randomToken(32);
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: sha256Hex(raw), userAgent: meta.userAgent?.slice(0, 300) ?? null, ip: meta.ip ?? null, expiresAt: new Date(Date.now() + SESSION_TTL * 1000) } });
  const token = await signSessionToken({ sub: user.id, sid: session.id }, SESSION_TTL);
  await audit({ actorUserId: user.id, action: "auth.login", ip: meta.ip });
  return { ok: true, token };
}

export function sessionCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const claims = await verifySessionToken(token);
    if (claims) await prisma.session.deleteMany({ where: { id: claims.sid } });
  }
}

export async function getActiveBrand(user: User): Promise<Brand | null> {
  const jar = await cookies();
  const wanted = jar.get(BRAND_COOKIE)?.value;
  const brands = await prisma.brand.findMany({ where: { ownerId: user.id, archivedAt: null }, orderBy: { createdAt: "asc" } });
  return brands.find((b) => b.id === wanted) ?? brands[0] ?? null;
}

export async function requireBrand(user: User): Promise<Brand> {
  const brand = await getActiveBrand(user);
  if (!brand) redirect("/brands?first=1");
  return brand;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
