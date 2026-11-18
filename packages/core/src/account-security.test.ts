/**
 * Account security: password rules and rotation, two-factor sign-in, recovery codes, reset links,
 * sessions, re-authentication, progressive sign-in back-off. Every block tries the abuse first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { authenticator } from "otplib";

process.env.TOKEN_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.AUTH_SECRET ??= randomBytes(32).toString("base64");
process.env.MAIL_PROVIDER = "test";

const { prisma } = await import("@sm/db");
const { hashPassword, verifyPassword, sha256Hex } = await import("@sm/security");
const core = await import("./index.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}
const run = Date.now().toString(36);
const GOOD = `Harbor-lantern-${run}-42`;
const GOOD2 = `Quiet-meadow-${run}-77`;
const noBreach = (async () => new Response("0000000000000000000000000000000000A:1\n", { status: 200 })) as unknown as typeof fetch;
const pwned = (async (url: string) => {
  // answer "found" for whatever suffix is asked: emulate a breached password
  const { createHash } = await import("node:crypto");
  void url;
  return new Response(`${createHash("sha1").update(`Breached-${run}-Passw0rd!`).digest("hex").toUpperCase().slice(5)}:9000\n`, { status: 200 });
}) as unknown as typeof fetch;

describe("password rules", () => {
  it("rejects short, common, personal and sequence-based passwords and accepts a long mixed one", () => {
    for (const bad of ["Short1!", "password1234", "Igerald12@", "aaaaaaaaaaaaaa", "Abcd1234efgh", "valentina2026!x"]) expect(core.checkPasswordStrength(bad, { email: "valentina@example.com" }).ok, bad).toBe(false);
    expect(core.checkPasswordStrength(GOOD, { email: "owner@example.com", name: "Sam Rivers" }).ok).toBe(true);
    expect(core.checkPasswordStrength("correct horse battery staple").ok).toBe(true); // long passphrase without symbols
  });
});

describe.skipIf(!dbOk)("password rotation, two-factor, reset and sessions", () => {
  const email = `acct-${run}@example.com`;
  let userId = "";
  let other = "";
  let sKeep = "";
  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email, name: "Sam Rivers", passwordHash: await hashPassword("Old-password-000!") } })).id;
    other = (await prisma.user.create({ data: { email: `other-${run}@example.com`, passwordHash: "x" } })).id;
    const mk = (uid: string, n: string) => prisma.session.create({ data: { userId: uid, tokenHash: sha256Hex(`${n}-${run}`), expiresAt: new Date(Date.now() + 3600_000), userAgent: n } });
    sKeep = (await mk(userId, "this-browser")).id;
    await mk(userId, "stolen-browser");
    await mk(other, "someone-else");
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, other] } } });
    await prisma.authThrottle.deleteMany({ where: { updatedAt: { gte: new Date(Date.now() - 6 * 3600_000) } } });
  });

  it("an exposed password forces a change; the change refuses the wrong current password, weak, reused, exposed and breached passwords", async () => {
    await core.denyPasswordReuse(userId, "Leaked-in-chat-2026!");
    await core.requirePasswordChange(userId);
    expect(core.accountGate((await prisma.user.findUnique({ where: { id: userId } }))!)).toBe("password");
    const change = (next: string, current = "Old-password-000!", f = noBreach) => core.changePassword(userId, { current, next, keepSessionId: sKeep, fetchImpl: f });
    await expect(change(GOOD, "not-the-password")).rejects.toThrow(/current password is wrong/);
    await expect(change("tooshort")).rejects.toThrow(/at least 12/);
    await expect(change("Old-password-000!")).rejects.toThrow(/used on this account before/);
    await expect(change("Leaked-in-chat-2026!")).rejects.toThrow(/used on this account before, or is known to be exposed/);
    await expect(change(`Breached-${run}-Passw0rd!`, "Old-password-000!", pwned)).rejects.toThrow(/known data breaches/);
    expect(await prisma.session.count({ where: { userId } })).toBe(2); // nothing changed yet
  });

  it("a successful change signs every other session out, keeps this one, and clears the forced change", async () => {
    await core.changePassword(userId, { current: "Old-password-000!", next: GOOD, keepSessionId: sKeep, fetchImpl: noBreach });
    const u = (await prisma.user.findUnique({ where: { id: userId } }))!;
    expect(await verifyPassword(GOOD, u.passwordHash)).toBe(true);
    expect(u.mustChangePassword).toBe(false);
    expect((await prisma.session.findMany({ where: { userId } })).map((s) => s.id)).toEqual([sKeep]);
    expect(await prisma.session.count({ where: { userId: other } })).toBe(1); // nobody else is affected
    // the old password can never come back
    await expect(core.changePassword(userId, { current: GOOD, next: "Old-password-000!", fetchImpl: noBreach })).rejects.toThrow(/used on this account before/);
  });

  let secret = "";
  let codes: string[] = [];
  it("two-factor enrolment needs a correct code; recovery codes are returned once and stored only as hashes", async () => {
    const start = await core.startTotpEnrollment(userId);
    secret = start.secret;
    expect(start.otpauthUrl).toContain("otpauth://totp/iGerald");
    await expect(core.confirmTotpEnrollment(userId, "000000")).rejects.toThrow(/not correct/);
    expect(core.mfaEnabled((await prisma.user.findUnique({ where: { id: userId } }))!)).toBe(false);
    codes = (await core.confirmTotpEnrollment(userId, authenticator.generate(secret), sKeep)).recoveryCodes;
    expect(codes).toHaveLength(10);
    const u = (await prisma.user.findUnique({ where: { id: userId } }))!;
    expect(core.mfaEnabled(u)).toBe(true);
    expect(u.totpSecretEnc).not.toContain(secret); // encrypted at rest
    const stored = await prisma.recoveryCode.findMany({ where: { userId } });
    expect(stored.some((r) => codes.includes(r.codeHash))).toBe(false);
  });

  it("a code works once (no replay); a recovery code works once; wrong codes fail", async () => {
    // the enrolment code's time step is spent: the same code cannot sign in
    expect(await core.verifySecondFactor(userId, { code: authenticator.generate(secret) })).toBeNull();
    expect(await core.verifySecondFactor(userId, { code: "123456" })).toBeNull();
    expect(await core.verifySecondFactor(userId, { recoveryCode: "AAAAA-AAAAA" })).toBeNull();
    expect(await core.verifySecondFactor(userId, { recoveryCode: codes[0]!.toLowerCase().replace("-", " ") })).toBe("recovery"); // typed loosely
    expect(await core.verifySecondFactor(userId, { recoveryCode: codes[0] })).toBeNull();
    expect(await core.recoveryCodesLeft(userId)).toBe(9);
    expect(await core.verifySecondFactor(other, { recoveryCode: codes[1] })).toBeNull(); // someone else's code is worthless
    await prisma.user.update({ where: { id: userId }, data: { totpLastStep: 0 } }); // pretend 30 seconds passed
    expect(await core.verifySecondFactor(userId, { code: authenticator.generate(secret) })).toBe("totp");
  });

  it("the password alone cannot turn two-factor off or mint new recovery codes", async () => {
    await expect(core.disableTotp(userId, { password: GOOD })).rejects.toThrow(/authenticator app or an unused recovery code/);
    await expect(core.disableTotp(userId, { password: "wrong", recoveryCode: codes[1] })).rejects.toThrow(/password is wrong/);
    await expect(core.regenerateRecoveryCodes(userId, {})).rejects.toThrow();
    expect(core.mfaEnabled((await prisma.user.findUnique({ where: { id: userId } }))!)).toBe(true);
    expect(await core.recoveryCodesLeft(userId)).toBe(9); // the refused attempts did not spend a code
  });

  it("reset: the same answer for unknown addresses, a single-use 30-minute link, and a second factor when the account has one", async () => {
    const box = core.testOutbox();
    box.length = 0;
    expect((await core.requestPasswordReset(`nobody-${run}@example.com`, "203.0.113.9", "https://app.example")).delivered).toBe(false);
    expect(box).toHaveLength(0);
    expect((await core.requestPasswordReset(email.toUpperCase(), "203.0.113.9", "https://app.example")).delivered).toBe(true);
    const token = /token=([\w-]+)/.exec(box[0]!.text)![1]!;
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0); // only the hash is stored
    await expect(core.resetPasswordWithToken("not-a-token", GOOD2, {}, { skipBreachCheck: true })).rejects.toThrow(/not valid/);
    await expect(core.resetPasswordWithToken(token, GOOD2, {}, { skipBreachCheck: true })).rejects.toThrow(/authenticator app or a recovery code/); // mailbox alone is not enough
    await expect(core.resetPasswordWithToken(token, "weak", { recoveryCode: codes[1] }, { skipBreachCheck: true })).rejects.toThrow(/at least 12/);
    // the weak attempt did not burn the link (it did spend the recovery code it was shown)
    await core.resetPasswordWithToken(token, GOOD2, { recoveryCode: codes[2] }, { skipBreachCheck: true });
    expect(await verifyPassword(GOOD2, (await prisma.user.findUnique({ where: { id: userId } }))!.passwordHash)).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0); // every session ended
    await expect(core.resetPasswordWithToken(token, `Another-${GOOD}`, { recoveryCode: codes[3] }, { skipBreachCheck: true })).rejects.toThrow(/not valid/);
    // an expired link
    await core.requestPasswordReset(email, null, "https://app.example");
    const t2 = /token=([\w-]+)/.exec(box[box.length - 1]!.text)![1]!;
    await prisma.passwordResetToken.updateMany({ where: { tokenHash: sha256Hex(t2) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(core.resetPasswordWithToken(t2, `Another-${GOOD}`, { recoveryCode: codes[3] }, { skipBreachCheck: true })).rejects.toThrow(/not valid/);
    // at most three requests an hour
    await core.requestPasswordReset(email, null, "https://app.example");
    expect((await core.requestPasswordReset(email, null, "https://app.example")).delivered).toBe(false);
  });

  it("sessions: listed for their owner only, revocable one by one or all at once, expire when idle, and sensitive actions need a recent password", async () => {
    const mk = (n: string, seenAgoMs = 0) => prisma.session.create({ data: { userId, tokenHash: sha256Hex(`${n}-${run}-2`), expiresAt: new Date(Date.now() + 3600_000), userAgent: n, lastSeenAt: new Date(Date.now() - seenAgoMs) } });
    const a = await mk("laptop");
    const b = await mk("phone");
    await mk("forgotten", core.SESSION_IDLE_MS + 60_000);
    const list = await core.listSessions(userId, a.id);
    expect(list.map((s) => s.userAgent).sort()).toEqual(["laptop", "phone"]); // the idle one is not live
    expect(list.find((s) => s.current)?.id).toBe(a.id);
    expect(await core.revokeSession(other, b.id)).toBe(false); // another user cannot end it
    expect(await core.revokeSession(userId, b.id)).toBe(true);
    expect(core.hasRecentAuth(a)).toBe(false);
    await expect(core.reauthenticate(userId, a.id, { password: "wrong" })).rejects.toThrow(/password is wrong/);
    await expect(core.reauthenticate(userId, a.id, { password: GOOD2 })).rejects.toThrow(/authenticator app/); // two-factor account: password alone is not a re-authentication
    await prisma.user.update({ where: { id: userId }, data: { totpLastStep: 0 } });
    await core.reauthenticate(userId, a.id, { password: GOOD2, code: authenticator.generate(secret) });
    expect(core.hasRecentAuth((await prisma.session.findUnique({ where: { id: a.id } }))!)).toBe(true);
    expect(core.hasRecentAuth({ reauthAt: new Date(Date.now() - core.REAUTH_WINDOW_MS - 1000) })).toBe(false);
    expect(await core.revokeOtherSessions(userId, a.id)).toBeGreaterThanOrEqual(1);
    expect((await prisma.session.findMany({ where: { userId } })).map((s) => s.id)).toEqual([a.id]);
  });

  it("turning two-factor off with password and a code starts a 24-hour deadline to enrol again", async () => {
    await prisma.user.update({ where: { id: userId }, data: { totpLastStep: 0 } });
    await core.disableTotp(userId, { password: GOOD2, code: authenticator.generate(secret) });
    const u = (await prisma.user.findUnique({ where: { id: userId } }))!;
    expect(core.mfaEnabled(u)).toBe(false);
    expect(await prisma.recoveryCode.count({ where: { userId } })).toBe(0);
    expect(core.accountGate(u)).toBe("ok");
    expect(core.accountGate(u, new Date(Date.now() + 25 * 3600_000))).toBe("mfa"); // after the deadline the account must enrol
  });

  it("sign-in back-off doubles on repeat, and a known device is not locked out by an attack on its account", async () => {
    const e = `backoff-${run}@example.com`;
    const ip = "198.51.100.77";
    for (let i = 0; i < 5; i++) await core.recordLoginFailure(e, ip);
    const first = await core.checkLoginAllowed(e, ip);
    expect(first.allowed).toBe(false);
    const later = new Date(Date.now() + 16 * 60_000); // first block over, attacker continues in the same window? no: new window
    for (let i = 0; i < 5; i++) await core.recordLoginFailure(e, ip, later);
    const second = await core.checkLoginAllowed(e, ip, later);
    expect(second.allowed).toBe(false);
    if (!first.allowed && !second.allowed) expect(second.retryAfterSeconds).toBeGreaterThan(first.retryAfterSeconds * 1.8);
    // distributed attack on one account
    const victim = (await prisma.user.findUnique({ where: { id: userId } }))!;
    for (let i = 0; i < 50; i++) await core.recordLoginFailure(victim.email, `10.7.${Math.floor(i / 200)}.${i + 1}`);
    expect((await core.checkLoginAllowed(victim.email, "192.0.2.200")).allowed).toBe(false); // a stranger is blocked
    expect(await core.activeLoginBlocks(victim.email, "192.0.2.200")).toContain("account");
    const cookie = core.knownDeviceToken(victim.id);
    expect(await core.isKnownDevice(victim.email, cookie)).toBe(true);
    expect(await core.isKnownDevice(victim.email, core.knownDeviceToken(other))).toBe(false);
    expect((await core.checkLoginAllowed(victim.email, "192.0.2.200", new Date(), { knownDevice: true })).allowed).toBe(true); // the owner's own browser still gets in
  });
});
