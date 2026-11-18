/** Environment isolation: a deployment must refuse a database that belongs to another environment. */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
const { prisma } = await import("@sm/db");
const { checkEnvironment, deploymentEnv, assertEnvironment, resetEnvironmentCheck } = await import("./environment.js");

let dbOk = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}
const setMarker = (v: string | null) => (v === null ? prisma.systemSetting.deleteMany({ where: { key: "env.name" } }) : prisma.systemSetting.upsert({ where: { key: "env.name" }, create: { key: "env.name", value: v }, update: { value: v } }));

describe("deployment environment", () => {
  it("is read from APP_ENV, then VERCEL_ENV, and falls back to local names", () => {
    expect(deploymentEnv({ VERCEL_ENV: "preview" } as NodeJS.ProcessEnv)).toBe("preview");
    expect(deploymentEnv({ VERCEL_ENV: "preview", APP_ENV: "production" } as NodeJS.ProcessEnv)).toBe("production");
    expect(deploymentEnv({ VITEST: "true" } as NodeJS.ProcessEnv)).toBe("test");
    expect(deploymentEnv({} as NodeJS.ProcessEnv)).toBe("development");
    expect(deploymentEnv({ APP_ENV: "staging-typo" } as NodeJS.ProcessEnv)).toBe("development"); // an unknown name never counts as production
  });
});

describe.skipIf(!dbOk)("database marker", () => {
  let before: unknown = null;
  beforeEach(() => resetEnvironmentCheck());
  afterAll(async () => {
    await setMarker(typeof before === "string" ? before : null);
    resetEnvironmentCheck();
  });

  it("a preview or local deployment is refused by the production database, and production by a preview database", async () => {
    before = (await prisma.systemSetting.findUnique({ where: { key: "env.name" } }))?.value ?? null;
    await setMarker("production");
    for (const env of ["preview", "development", "test"] as const) {
      const r = await checkEnvironment(env);
      expect(r.ok, env).toBe(false);
      if (!r.ok) expect(r.reason).toContain("production database");
    }
    expect((await checkEnvironment("production")).ok).toBe(true);
    await setMarker("preview");
    expect((await checkEnvironment("production")).ok).toBe(false);
    expect((await checkEnvironment("preview")).ok).toBe(true);
    // the guard used by every request turns the mismatch into a 503 and keeps refusing
    await setMarker("production");
    await expect(assertEnvironment()).rejects.toMatchObject({ status: 503, code: "environment_mismatch" });
    await expect(assertEnvironment()).rejects.toMatchObject({ code: "environment_mismatch" });
  });

  it("an unmarked database that already holds accounts cannot be claimed by a preview; local work may claim it", async () => {
    await setMarker(null);
    const u = await prisma.user.create({ data: { email: `env-${Date.now()}@example.com`, passwordHash: "x" } });
    try {
      const preview = await checkEnvironment("preview");
      expect(preview.ok).toBe(false);
      expect(await prisma.systemSetting.findUnique({ where: { key: "env.name" } })).toBeNull(); // the refusal wrote nothing
      const local = await checkEnvironment("test");
      expect(local).toMatchObject({ ok: true, claimed: true });
      expect((await checkEnvironment("development")).ok).toBe(true); // development and test share a local database
      expect((await checkEnvironment("preview")).ok).toBe(false);
    } finally {
      await prisma.user.delete({ where: { id: u.id } });
    }
  });
});
