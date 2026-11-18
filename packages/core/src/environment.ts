/**
 * Environment isolation. Every database records which environment it belongs to
 * (`SystemSetting env.name`), and a deployment only works against a database of its own
 * environment. A preview build that is handed the production connection string therefore stops
 * instead of reading or changing production records.
 *
 * Deployment environment: `APP_ENV` if set, else `VERCEL_ENV` (production | preview | development),
 * else "test" under the test runner, else "development".
 */
import { prisma } from "@sm/db";
import { AppError } from "./connections";

export type EnvName = "production" | "preview" | "development" | "test";
const NAMES: EnvName[] = ["production", "preview", "development", "test"];
const KEY = "env.name";

export function deploymentEnv(env: NodeJS.ProcessEnv = process.env): EnvName {
  const raw = (env.APP_ENV ?? env.VERCEL_ENV ?? (env.VITEST ? "test" : env.NODE_ENV === "test" ? "test" : "development")).toLowerCase();
  return (NAMES as string[]).includes(raw) ? (raw as EnvName) : "development";
}

export type EnvCheck = { ok: true; env: EnvName; database: EnvName; claimed: boolean } | { ok: false; env: EnvName; database: EnvName | null; reason: string };

/**
 * Compares the deployment with the database's marker.
 * - Same name: fine. Local work ("development" and "test") may share one local database.
 * - No marker: production and local environments claim the database. A preview claims it only
 *   when it holds no accounts at all — a database that already has users is somebody's data.
 * - Different name: refused.
 */
export async function checkEnvironment(env: EnvName = deploymentEnv()): Promise<EnvCheck> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  const database = typeof row?.value === "string" && (NAMES as string[]).includes(row.value) ? (row.value as EnvName) : null;
  const local = (n: EnvName) => n === "development" || n === "test";
  if (database) {
    if (database === env || (local(database) && local(env))) return { ok: true, env, database, claimed: false };
    return { ok: false, env, database, reason: `This ${env} deployment is connected to the ${database} database.` };
  }
  if (env === "preview" && (await prisma.user.count()) > 0) return { ok: false, env, database: null, reason: "This preview deployment is connected to a database that already holds accounts and is not marked as a preview database." };
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: env, encrypted: false }, update: {} });
  return { ok: true, env, database: env, claimed: true };
}

let verified: Promise<void> | null = null;
/** Throws 503 when the deployment and the database do not belong together. Checked once per server instance; a failure is re-checked on the next call. */
export function assertEnvironment(): Promise<void> {
  if (!process.env.DATABASE_URL) return Promise.reject(new AppError("This deployment has no database configured, so it cannot be used. Production data is not reachable from here.", 503, "no_database"));
  verified ??= checkEnvironment().then((r) => {
    if (!r.ok) {
      verified = null;
      throw new AppError(`${r.reason} Nothing was read or changed. Give this deployment its own database.`, 503, "environment_mismatch");
    }
  }, (err) => {
    verified = null;
    throw err;
  });
  return verified;
}
/** For tests. */
export function resetEnvironmentCheck(): void {
  verified = null;
}
