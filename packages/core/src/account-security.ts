/**
 * Account security: password rules and rotation, two-factor sign-in (TOTP + recovery codes),
 * password reset links, sessions and re-authentication.
 *
 * Nothing here invents cryptography: passwords use the existing scrypt functions, TOTP comes from
 * `otplib`, secrets at rest use the existing AES-256-GCM helper, tokens and codes come from the
 * operating system's random source and are stored only as SHA-256 hashes.
 * Passwords, codes and tokens are never written to logs or audit details.
 */
import { randomBytes, randomInt } from "node:crypto";
import { authenticator } from "otplib";
import { prisma } from "@sm/db";
import type { Session, User } from "@sm/db";
import { decryptJson, encryptJson, hashPassword, hmacSha256Hex, randomToken, safeEqual, sha256Hex, verifyPassword, type EncryptedBlob } from "@sm/security";
import { audit, notify } from "./audit";
import { AppError } from "./connections";
import { sendMail } from "./mailer";

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 12;
const COMMON = ["password", "passw0rd", "123456", "12345678", "qwerty", "azerty", "letmein", "welcome", "admin", "iloveyou", "abc123", "111111", "000000", "monkey", "dragon", "football", "sunshine", "princess", "changeme", "secret", "igerald"];

export interface StrengthResult { ok: boolean; problems: string[] }

/** Rules a person can satisfy and remember: long, not obvious, not built from their own name. */
export function checkPasswordStrength(password: string, ctx: { email?: string | null; name?: string | null } = {}): StrengthResult {
  const problems: string[] = [];
  const lower = password.toLowerCase();
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (password.length > 200) problems.push("Use at most 200 characters.");
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 16 && classes < 3) problems.push("Mix at least three of: lower-case letters, capitals, digits, symbols — or use 16 or more characters.");
  if (new Set(password).size < 6) problems.push("Too few different characters.");
  const stripped = lower.replace(/[^a-z]/g, "");
  if (COMMON.some((w) => lower.includes(w) && w.length >= lower.length / 2) || COMMON.includes(stripped)) problems.push("This is built on a very common password.");
  const personal = [ctx.email?.split("@")[0], ...(ctx.name ?? "").split(/\s+/)].map((v) => (v ?? "").toLowerCase()).filter((v) => v.length >= 4);
  if (personal.some((v) => lower.includes(v))) problems.push("Do not build the password from your name or e-mail address.");
  if (/^(.)\1+$/.test(password) || /(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(lower) && password.length < 16) problems.push("Avoid simple sequences such as 1234.");
  return { ok: problems.length === 0, problems };
}

/**
 * Has this password appeared in known breaches? Uses the Pwned Passwords range API: only the first
 * five characters of the SHA-1 hash leave the server, never the password. Network trouble counts as
 * "unknown" (null) and does not block the user.
 */
export async function breachCount(password: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const { createHash } = await import("node:crypto");
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, { headers: { "add-padding": "true" }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    for (const line of (await res.text()).split("\n")) {
      const [suffix, count] = line.trim().split(":");
      if (suffix === sha1.slice(5)) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

async function wasUsedBefore(user: User, candidate: string): Promise<boolean> {
  if (await verifyPassword(candidate, user.passwordHash)) return true;
  const old = await prisma.passwordHistory.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 24, select: { passwordHash: true } });
  for (const h of old) if (await verifyPassword(candidate, h.passwordHash)) return true;
  return false;
}

/** Records a password that must never be accepted again for this account (for example one that was exposed). Only its hash is kept. */
export async function denyPasswordReuse(userId: string, exposedPassword: string, reason: "previous" | "exposed" = "exposed"): Promise<void> {
  await prisma.passwordHistory.create({ data: { userId, passwordHash: await hashPassword(exposedPassword), reason } });
}

/** Marks the account's password as exposed: nothing but the password-change screen works until it is changed. */
export async function requirePasswordChange(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
  await audit({ actorUserId: userId, action: "auth.password_change_required" });
}

async function setNewPassword(user: User, next: string, opts: { keepSessionId?: string | null; action: string; ip?: string | null; skipBreachCheck?: boolean; fetchImpl?: typeof fetch }): Promise<void> {
  const strength = checkPasswordStrength(next, { email: user.email, name: user.name });
  if (!strength.ok) throw new AppError(strength.problems.join(" "), 422, "weak_password");
  if (await wasUsedBefore(user, next)) throw new AppError("This password was used on this account before, or is known to be exposed. Choose a different one.", 422, "password_reused");
  if (!opts.skipBreachCheck) {
    const n = await breachCount(next, opts.fetchImpl);
    if (n && n > 0) throw new AppError("This password appears in known data breaches. Choose a different one.", 422, "password_breached");
  }
  await prisma.$transaction([
    prisma.passwordHistory.create({ data: { userId: user.id, passwordHash: user.passwordHash, reason: "previous" } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false } }),
    // Every other session ends: whoever held the old password is signed out.
    prisma.session.deleteMany({ where: { userId: user.id, ...(opts.keepSessionId ? { id: { not: opts.keepSessionId } } : {}) } }),
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
  ]);
  if (opts.keepSessionId) await prisma.session.updateMany({ where: { id: opts.keepSessionId }, data: { reauthAt: new Date() } });
  await audit({ actorUserId: user.id, action: opts.action, ip: opts.ip ?? undefined });
  await notify({ level: "warning", title: "Your password was changed", body: "All other sessions were signed out. If this was not you, use account recovery immediately.", link: "/account/security" });
}

export async function changePassword(userId: string, input: { current: string; next: string; keepSessionId?: string | null; ip?: string | null; skipBreachCheck?: boolean; fetchImpl?: typeof fetch }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Account not found.", 404, "not_found");
  if (!(await verifyPassword(input.current, user.passwordHash))) {
    await audit({ actorUserId: userId, action: "auth.password_change", outcome: "denied", ip: input.ip ?? undefined });
    throw new AppError("The current password is wrong.", 403, "bad_password");
  }
  await setNewPassword(user, input.next, { keepSessionId: input.keepSessionId, action: "auth.password_change", ip: input.ip, skipBreachCheck: input.skipBreachCheck, fetchImpl: input.fetchImpl });
}

// ---------------------------------------------------------------------------
// Two-factor sign-in (TOTP) and recovery codes
// ---------------------------------------------------------------------------

const totp = authenticator.clone({ window: 1 }); // accept the previous and next 30-second step for clock drift
const ISSUER = "iGerald";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const seal = (secret: string) => JSON.stringify(encryptJson({ secret }));
const unseal = (stored: string) => decryptJson<{ secret: string }>(JSON.parse(stored) as EncryptedBlob).secret;
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const recoveryHash = (userId: string, code: string) => sha256Hex(`recovery:${userId}:${normalizeCode(code)}`);

export function mfaEnabled(user: Pick<User, "totpEnabledAt" | "totpSecretEnc">): boolean {
  return Boolean(user.totpEnabledAt && user.totpSecretEnc);
}

/** Step 1 of enrolment: a new secret, kept aside until a code proves the authenticator app has it. */
export async function startTotpEnrollment(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("Account not found.", 404, "not_found");
  if (mfaEnabled(user)) throw new AppError("Two-factor sign-in is already on. Turn it off first to enrol a new device.", 409, "mfa_already_enabled");
  const secret = authenticator.generateSecret(20);
  await prisma.user.update({ where: { id: userId }, data: { totpPendingEnc: seal(secret) } });
  return { secret, otpauthUrl: totp.keyuri(user.email, ISSUER, secret) };
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryHash(userId, c) })) }),
  ]);
  return codes;
}

/** Step 2: the first code turns two-factor sign-in on and returns the recovery codes — shown once, stored only as hashes. */
export async function confirmTotpEnrollment(userId: string, code: string, sessionId?: string | null): Promise<{ recoveryCodes: string[] }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.totpPendingEnc) throw new AppError("Start the set-up again.", 409, "mfa_not_started");
  const secret = unseal(user.totpPendingEnc);
  const delta = totp.checkDelta(code.replace(/\s/g, ""), secret);
  if (delta === null) throw new AppError("That code is not correct. Check the time on your phone and try the next code.", 422, "mfa_bad_code");
  await prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: seal(secret), totpPendingEnc: null, totpEnabledAt: new Date(), totpLastStep: Math.floor(Date.now() / 30000) + delta, mfaGraceUntil: null } });
  if (sessionId) await prisma.session.updateMany({ where: { id: sessionId, userId }, data: { mfaAt: new Date(), reauthAt: new Date() } });
  const recoveryCodes = await replaceRecoveryCodes(userId);
  await audit({ actorUserId: userId, action: "auth.mfa_enabled" });
  await notify({ level: "info", title: "Two-factor sign-in is on", body: "Keep the recovery codes somewhere safe; each works once.", link: "/account/security" });
  return { recoveryCodes };
}

/**
 * Checks a second factor: a 6-digit code from the authenticator app (usable once) or a recovery
 * code (usable once, then gone). Returns which one matched.
 */
export async function verifySecondFactor(userId: string, input: { code?: string | null; recoveryCode?: string | null }): Promise<"totp" | "recovery" | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !mfaEnabled(user)) return null;
  if (input.code) {
    const delta = totp.checkDelta(input.code.replace(/\s/g, ""), unseal(user.totpSecretEnc!));
    if (delta === null) return null;
    const step = Math.floor(Date.now() / 30000) + delta;
    // A code that was already accepted (or an older one) is refused: watching someone type it is not enough.
    const used = await prisma.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return used.count === 1 ? "totp" : null;
  }
  if (input.recoveryCode) {
    const used = await prisma.recoveryCode.updateMany({ where: { userId, codeHash: recoveryHash(userId, input.recoveryCode), usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return null;
    const left = await prisma.recoveryCode.count({ where: { userId, usedAt: null } });
    await audit({ actorUserId: userId, action: "auth.recovery_code_used", details: { remaining: left } });
    await notify({ level: "warning", title: "A recovery code was used to sign in", body: `${left} recovery code${left === 1 ? "" : "s"} left. If this was not you, change your password and set up two-factor sign-in again.`, link: "/account/security" });
    return "recovery";
  }
  return null;
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  return prisma.recoveryCode.count({ where: { userId, usedAt: null } });
}

/** New recovery codes replace all old ones. Needs a current second factor, not just the password. */
export async function regenerateRecoveryCodes(userId: string, proof: { code?: string | null; recoveryCode?: string | null }): Promise<string[]> {
  if (!(await verifySecondFactor(userId, proof))) throw new AppError("Enter a current code from your authenticator app.", 403, "mfa_bad_code");
  const codes = await replaceRecoveryCodes(userId);
  await audit({ actorUserId: userId, action: "auth.recovery_codes_regenerated" });
  return codes;
}

/**
 * Turning two-factor off needs the password AND a second factor: knowing the password alone must
 * never be enough to remove the protection that exists for the case the password is known.
 */
export async function disableTotp(userId: string, proof: { password: string; code?: string | null; recoveryCode?: string | null }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !mfaEnabled(user)) throw new AppError("Two-factor sign-in is not on.", 409, "mfa_not_enabled");
  if (!(await verifyPassword(proof.password, user.passwordHash))) throw new AppError("The password is wrong.", 403, "bad_password");
  if (!(await verifySecondFactor(userId, proof))) throw new AppError("Enter a current code from your authenticator app or an unused recovery code.", 403, "mfa_bad_code");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null, mfaGraceUntil: new Date(Date.now() + 24 * 3600_000) } }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
  await audit({ actorUserId: userId, action: "auth.mfa_disabled" });
  await notify({ level: "error", title: "Two-factor sign-in was turned off", body: "The account is protected by its password only. Set it up again within 24 hours.", link: "/account/security" });
}

/** What the account still has to do before it may be used normally. */
export function accountGate(user: Pick<User, "mustChangePassword" | "totpEnabledAt" | "totpSecretEnc" | "mfaGraceUntil">, now = new Date()): "ok" | "password" | "mfa" {
  if (user.mustChangePassword) return "password";
  if (!mfaEnabled(user) && user.mfaGraceUntil && user.mfaGraceUntil < now) return "mfa";
  return "ok";
}

// ---------------------------------------------------------------------------
// Password reset links
// ---------------------------------------------------------------------------

const RESET_TTL_MS = 30 * 60_000;

/**
 * Starts a reset. The answer to the caller is the same whether or not the address exists.
 * `delivered` tells the server side whether a message actually went out (no mail provider = no).
 */
export async function requestPasswordReset(email: string, ip: string | null, baseUrl: string): Promise<{ delivered: boolean }> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    await audit({ action: "auth.password_reset_request", outcome: "denied", details: { reason: "unknown address" }, ip: ip ?? undefined });
    return { delivered: false };
  }
  const recent = await prisma.passwordResetToken.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
  if (recent >= 3) {
    await audit({ actorUserId: user.id, action: "auth.password_reset_request", outcome: "denied", details: { reason: "too many requests" }, ip: ip ?? undefined });
    return { delivered: false };
  }
  const token = randomToken(32);
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + RESET_TTL_MS), requestedIp: ip } });
  const r = await sendMail({ to: user.email, subject: "Reset your iGerald password", text: `Open this link within 30 minutes to choose a new password:\n\n${baseUrl.replace(/\/$/, "")}/reset?token=${token}\n\nIf you did not ask for this, ignore this message; your password stays as it is.` });
  await audit({ actorUserId: user.id, action: "auth.password_reset_request", outcome: r.sent ? "ok" : "error", details: r.sent ? undefined : { reason: r.reason }, ip: ip ?? undefined });
  return { delivered: r.sent };
}

/**
 * Completes a reset: single-use token, not expired; the new password passes the same rules; every
 * session ends. An account with two-factor sign-in also needs a second factor here — a stolen
 * mailbox must not be enough to take the account.
 */
export async function resetPasswordWithToken(token: string, next: string, proof: { code?: string | null; recoveryCode?: string | null } = {}, opts: { ip?: string | null; skipBreachCheck?: boolean } = {}): Promise<void> {
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("This reset link is not valid any more. Ask for a new one.", 400, "reset_invalid");
  if (mfaEnabled(row.user) && !(await verifySecondFactor(row.userId, proof))) throw new AppError("Enter a code from your authenticator app or a recovery code.", 403, "mfa_required");
  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new AppError("This reset link was already used.", 400, "reset_invalid");
  try {
    await setNewPassword(row.user, next, { action: "auth.password_reset", ip: opts.ip, skipBreachCheck: opts.skipBreachCheck });
  } catch (err) {
    // A rejected password (too weak, reused) must not burn the link.
    await prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: null } });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sessions and re-authentication
// ---------------------------------------------------------------------------

export const SESSION_ABSOLUTE_MS = 7 * 24 * 3600_000; // a session never lives longer than this
export const SESSION_IDLE_MS = 12 * 3600_000; // unused for this long = signed out
export const REAUTH_WINDOW_MS = 10 * 60_000; // sensitive actions need the password entered this recently

export function sessionIsLive(s: Pick<Session, "expiresAt" | "lastSeenAt">, now = new Date()): boolean {
  return s.expiresAt > now && now.getTime() - s.lastSeenAt.getTime() <= SESSION_IDLE_MS;
}
export function hasRecentAuth(s: Pick<Session, "reauthAt">, now = new Date()): boolean {
  return Boolean(s.reauthAt && now.getTime() - s.reauthAt.getTime() <= REAUTH_WINDOW_MS);
}

export interface SessionView { id: string; current: boolean; userAgent: string | null; ip: string | null; createdAt: Date; lastSeenAt: Date; expiresAt: Date; secondFactor: boolean }
export async function listSessions(userId: string, currentId: string | null): Promise<SessionView[]> {
  const rows = await prisma.session.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  return rows.filter((s) => sessionIsLive(s)).map((s) => ({ id: s.id, current: s.id === currentId, userAgent: s.userAgent, ip: s.ip, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, secondFactor: Boolean(s.mfaAt) }));
}
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const r = await prisma.session.deleteMany({ where: { id: sessionId, userId } }); // only one's own
  if (r.count) await audit({ actorUserId: userId, action: "auth.session_revoked", targetType: "session", targetId: sessionId });
  return r.count === 1;
}
export async function revokeOtherSessions(userId: string, keepId: string | null): Promise<number> {
  const r = await prisma.session.deleteMany({ where: { userId, ...(keepId ? { id: { not: keepId } } : {}) } });
  await audit({ actorUserId: userId, action: "auth.sessions_revoked", details: { count: r.count } });
  return r.count;
}
/** Password (and second factor when enabled) entered again in this session. */
export async function reauthenticate(userId: string, sessionId: string, proof: { password: string; code?: string | null; recoveryCode?: string | null }): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(proof.password, user.passwordHash))) {
    await audit({ actorUserId: userId, action: "auth.reauth", outcome: "denied" });
    throw new AppError("The password is wrong.", 403, "bad_password");
  }
  if (mfaEnabled(user) && !(await verifySecondFactor(userId, proof))) throw new AppError("Enter a current code from your authenticator app.", 403, "mfa_bad_code");
  await prisma.session.updateMany({ where: { id: sessionId, userId }, data: { reauthAt: new Date(), ...(mfaEnabled(user) ? { mfaAt: new Date() } : {}) } });
  await audit({ actorUserId: userId, action: "auth.reauth" });
}

// ---------------------------------------------------------------------------
// Known device (protects the owner from deliberate lock-out) and new-device notice
// ---------------------------------------------------------------------------

const deviceKey = () => process.env.AUTH_SECRET ?? "";
/** Value of the cookie a browser receives after a successful sign-in to this account. It grants nothing except exemption from the account-wide sign-in limit. */
export function knownDeviceToken(userId: string): string {
  return hmacSha256Hex(deviceKey(), `known-device:${userId}`);
}
export async function isKnownDevice(email: string, cookieValue: string | null | undefined): Promise<boolean> {
  if (!cookieValue || !deviceKey()) return false;
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  return Boolean(user && safeEqual(cookieValue, knownDeviceToken(user.id)));
}
export async function noteSignIn(user: Pick<User, "id" | "email">, meta: { ip: string | null; userAgent: string | null; knownDevice: boolean }): Promise<void> {
  if (meta.knownDevice) return;
  const earlier = await prisma.session.count({ where: { userId: user.id } });
  if (earlier <= 1) return; // the very first session of an account is not "new device" news
  await notify({ level: "warning", title: "New sign-in to your account", body: `From ${meta.ip ?? "an unknown address"} using ${(meta.userAgent ?? "an unknown browser").slice(0, 80)}. If this was not you, change your password and review your sessions.`, link: "/account/security" });
}

/** A short random value for one-off uses (pending two-factor step). */
export function randomId(): string {
  return randomBytes(18).toString("base64url");
}
