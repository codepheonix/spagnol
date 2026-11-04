import { prisma } from "@sm/db";
import { json } from "@/lib/api";

/** Public liveness probe (no secrets, no data). */
export async function GET() {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    db = `error: ${(err as Error).message.slice(0, 120)}`;
  }
  return json({ ok: db === "ok", db, time: new Date().toISOString(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" }, { status: db === "ok" ? 200 : 503 });
}
