import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma, type Brand, type Session, type User } from "@sm/db";
import { hashPassword, randomToken, sha256Hex, signSessionToken, verifyPassword, verifySessionToken } from "@sm/security";
import { accountGate, assertEnvironment, audit, knownDeviceToken, mfaEnabled, noteSignIn, sessionIsLive, verifySecondFactor, SESSION_ABSOLUTE_MS } from "@sm/core";

export const SESSION_COOKIE = "sm_session";
export const BRAND_COOKIE = "sm_brand";
export const LOCALE_COOKIE = "ig_locale";
/** Marks a browser that has signed in to an account before. It grants nothing but exemption from the account-wide sign-in limit. */
export const DEVICE_COOKIE = "ig_device";
const SESSION_TTL = Math.floor(SESSION_ABSOLUTE_MS / 1000); // 7 days, and 12 hours when unused
const PENDING_TTL = 10 * 60; // password accepted, second factor still to come

type Live = { user: User; session: Session; pendingSecondFactor: boolean };

/** Reads the session behind the cookie. One database read per request, however many callers ask. */
const readSession = cache(async (): Promise<Live | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  await assertEnvironment();
  const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  if (!session || session.userId !== claims.sub || !sessionIsLive(session)) return null;
  const { user, ...row } = session;
  const pendingSecondFactor = mfaEnabled(user) && !row.mfaAt;
  // Activity keeps the session alive; one write a minute at most.
  if (!pendingSecondFactor && Date.now() - row.lastSeenAt.getTime() > 60_000) await prisma.session.updateMany({ where: { id: row.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return { user, session: row, pendingSecondFactor };
});

/** The signed-in session. A session that still owes its second factor is not signed in. */
export async function getSession(): Promise<{ user: User; session: Session } | null> {
  const s = await readSession();
  return s && !s.pendingSecondFactor ? { user: s.user, session: s.session } : null;
}

/** The session waiting for its two-factor code, if that is where this browser is. */
export async function getPendingSession(): Promise<{ user: User; session: Session } | null> {
  const s = await readSession();
  return s && s.pendingSecondFactor ? { user: s.user, session: s.session } : null;
}

export async function getSessionUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/** Where an account that still has something to do is sent, whatever page it asked for. */
export function gatePath(user: User): string | null {
  const gate = accountGate(user);
  return gate === "password" ? "/account/password" : gate === "mfa" ? "/account/security" : null;
}

/**
 * A page's signed-in user. An account whose password must be changed, or whose two-factor deadline
 * has passed, is sent to that screen and nowhere else; only the account pages pass `gate: false`.
 */
export async function requireUser(opts: { gate?: boolean } = {}): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (opts.gate !== false) {
    const to = gatePath(user);
    if (to) redirect(to);
  }
  return user;
}

type Meta = { userAgent?: string | null; ip?: string | null };
export type LoginResult = { ok: true; token: string; maxAge: number; needsSecondFactor: boolean; userId: string } | { ok: false; error: string };

/**
 * Step one of sign-in: e-mail and password. An account with two-factor sign-in gets a short-lived
 * session that opens nothing until the code is entered (`completeSecondFactor`).
 */
export async function login(email: string, password: string, meta: Meta & { knownDevice?: boolean }): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  // Constant-time-ish: always run a hash verify even if the user is missing.
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, await hashPassword("dummy-password-x")).then(() => false);
  if (!user || !ok) {
    await audit({ action: "auth.login", outcome: "denied", details: { email: email.trim().toLowerCase() }, ip: meta.ip });
    return { ok: false, error: "invalid_credentials" };
  }
  const needsSecondFactor = mfaEnabled(user);
  const ttl = needsSecondFactor ? PENDING_TTL : SESSION_TTL;
  const session = await prisma.session.create({ data: { userId: user.id, tokenHash: sha256Hex(randomToken(32)), userAgent: meta.userAgent?.slice(0, 300) ?? null, ip: meta.ip ?? null, expiresAt: new Date(Date.now() + ttl * 1000), reauthAt: needsSecondFactor ? null : new Date() } });
  const token = await signSessionToken({ sub: user.id, sid: session.id }, ttl);
  if (needsSecondFactor) {
    await audit({ actorUserId: user.id, action: "auth.login_password_ok", ip: meta.ip });
  } else {
    await audit({ actorUserId: user.id, action: "auth.login", ip: meta.ip });
    await noteSignIn(user, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, knownDevice: Boolean(meta.knownDevice) });
  }
  return { ok: true, token, maxAge: ttl, needsSecondFactor, userId: user.id };
}

/** Step two: the code from the authenticator app, or a recovery code. Turns the waiting session into a real one. */
export async function completeSecondFactor(proof: { code?: string | null; recoveryCode?: string | null }, meta: Meta & { knownDevice?: boolean }): Promise<{ ok: true; token: string; maxAge: number; userId: string; method: "totp" | "recovery" } | { ok: false; error: "no_pending" | "bad_code"; email?: string }> {
  const pending = await getPendingSession();
  if (!pending) return { ok: false, error: "no_pending" };
  const method = await verifySecondFactor(pending.user.id, proof);
  if (!method) {
    await audit({ actorUserId: pending.user.id, action: "auth.login_second_factor", outcome: "denied", ip: meta.ip });
    return { ok: false, error: "bad_code", email: pending.user.email };
  }
  const now = new Date();
  await prisma.session.update({ where: { id: pending.session.id }, data: { mfaAt: now, reauthAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL * 1000) } });
  const token = await signSessionToken({ sub: pending.user.id, sid: pending.session.id }, SESSION_TTL);
  await audit({ actorUserId: pending.user.id, action: "auth.login", details: { secondFactor: method }, ip: meta.ip });
  await noteSignIn(pending.user, { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, knownDevice: Boolean(meta.knownDevice) });
  return { ok: true, token, maxAge: SESSION_TTL, userId: pending.user.id, method };
}

export function sessionCookieOptions(maxAge: number = SESSION_TTL) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

/** Sets the cookie that tells the sign-in limiter this browser has been here before. */
export async function rememberDevice(userId: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, knownDeviceToken(userId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
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
  if (!brand) redirect("/organizations?first=1");
  return brand;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
