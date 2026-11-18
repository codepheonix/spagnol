/**
 * Sign-in throttle. Counters live in the database, so the limit holds no matter which server
 * instance answers a request.
 *
 * Three counters per failed attempt:
 *   pair    — this e-mail from this IP address: 5 failures in 15 minutes  -> blocked 15 minutes
 *   ip      — this IP address, any e-mail:     20 failures in 15 minutes  -> blocked 15 minutes
 *   account — this e-mail from anywhere:       50 failures in 60 minutes  -> blocked 15 minutes
 *
 * The pair rule stops ordinary guessing. The account rule slows guessing spread over many
 * addresses; it is deliberately high so that one person failing a few times elsewhere cannot lock
 * the real owner out. A successful sign-in clears only the pair counter.
 */
import { createHash } from "node:crypto";
import { prisma } from "@sm/db";

interface Rule { limit: number; windowMs: number; blockMs: number }
export const LOGIN_RULES: Record<"pair" | "ip" | "account", Rule> = {
  pair: { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
  ip: { limit: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
  account: { limit: 50, windowMs: 60 * 60_000, blockMs: 15 * 60_000 },
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function keys(email: string, ip: string | null): Array<{ key: string; rule: Rule }> {
  const e = email.trim().toLowerCase();
  const a = ip?.trim() || "unknown";
  return [
    { key: hash(`pair:${e}|${a}`), rule: LOGIN_RULES.pair },
    { key: hash(`ip:${a}`), rule: LOGIN_RULES.ip },
    { key: hash(`acct:${e}`), rule: LOGIN_RULES.account },
  ];
}

export type LoginGate = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Call before checking the password. Never reveals which rule matched. */
export async function checkLoginAllowed(email: string, ip: string | null, now = new Date()): Promise<LoginGate> {
  const rows = await prisma.authThrottle.findMany({ where: { key: { in: keys(email, ip).map((k) => k.key) }, blockedUntil: { gt: now } }, select: { blockedUntil: true } });
  if (rows.length === 0) return { allowed: true };
  const until = Math.max(...rows.map((r) => r.blockedUntil!.getTime()));
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((until - now.getTime()) / 1000)) };
}

/** A UTC instant as PostgreSQL `timestamp` text. Passed as text and cast, so the session time zone of the database connection can never shift it. */
const ts = (d: Date) => d.toISOString().slice(0, 23).replace("T", " ");

/** Call after a wrong e-mail or password. One atomic statement per counter, safe under concurrency. */
export async function recordLoginFailure(email: string, ip: string | null, now = new Date()): Promise<void> {
  for (const { key, rule } of keys(email, ip)) {
    const at = ts(now);
    const windowFloor = ts(new Date(now.getTime() - rule.windowMs));
    const blockUntil = ts(new Date(now.getTime() + rule.blockMs));
    await prisma.$executeRaw`
      INSERT INTO "AuthThrottle" ("key", "failures", "windowStart", "blockedUntil", "updatedAt")
      VALUES (${key}, 1, ${at}::timestamp, NULL, ${at}::timestamp)
      ON CONFLICT ("key") DO UPDATE SET
        "failures" = CASE WHEN "AuthThrottle"."windowStart" < ${windowFloor}::timestamp THEN 1 ELSE "AuthThrottle"."failures" + 1 END,
        "windowStart" = CASE WHEN "AuthThrottle"."windowStart" < ${windowFloor}::timestamp THEN ${at}::timestamp ELSE "AuthThrottle"."windowStart" END,
        "blockedUntil" = CASE
          WHEN "AuthThrottle"."windowStart" >= ${windowFloor}::timestamp AND "AuthThrottle"."failures" + 1 >= ${rule.limit} THEN ${blockUntil}::timestamp
          ELSE "AuthThrottle"."blockedUntil" END,
        "updatedAt" = ${at}::timestamp`;
  }
}

/** Call after a correct sign-in: the person at this address knows the password. */
export async function recordLoginSuccess(email: string, ip: string | null): Promise<void> {
  await prisma.authThrottle.deleteMany({ where: { key: keys(email, ip)[0]!.key } });
}

/** Housekeeping: counters that can no longer matter. */
export async function pruneAuthThrottle(now = new Date()): Promise<number> {
  const r = await prisma.authThrottle.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60_000) } } });
  return r.count;
}
