import { prisma } from "@sm/db";
import { checkEnvironment, deploymentEnv } from "@sm/core";
import { json } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe for uptime monitors. It says whether the database answers, whether this
 * deployment and its database belong to the same environment, and how long ago the scheduler last
 * ran. No secrets, no customer data, and no error text — details go to the server log only.
 */
export async function GET() {
  const env = deploymentEnv();
  let db: "ok" | "error" | "not_configured" = "ok";
  let environment: "ok" | "mismatch" | "unknown" = "unknown";
  let schedulerSecondsAgo: number | null = null;
  if (!process.env.DATABASE_URL) db = "not_configured";
  else {
    try {
      await prisma.$queryRaw`SELECT 1`;
      environment = (await checkEnvironment(env)).ok ? "ok" : "mismatch";
      if (environment === "ok") {
        const tick = await prisma.systemSetting.findUnique({ where: { key: "jobs.lastTick" } });
        const at = (tick?.value as { at?: string } | null)?.at;
        if (at && !Number.isNaN(Date.parse(at))) schedulerSecondsAgo = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000));
      }
    } catch (err) {
      db = "error";
      console.error("[health]", (err as Error).message);
    }
  }
  const ok = db === "ok" && environment === "ok";
  return json({ ok, db, env, environment, schedulerSecondsAgo, time: new Date().toISOString(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
