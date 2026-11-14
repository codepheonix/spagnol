import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { prisma, type Brand, type User } from "@sm/db";
import { AppError } from "@sm/core";
import { ProviderError } from "@sm/integrations";
import { getSessionUser, getActiveBrand } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export async function apiUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Not signed in.", "unauthenticated");
  return user;
}

/** Resolves the brand from `?brandId=`/body or the active-brand cookie, enforcing ownership server-side. */
export async function apiBrand(user: User, brandId?: string | null): Promise<Brand> {
  if (brandId) {
    const b = await prisma.brand.findFirst({ where: { id: brandId, ownerId: user.id, archivedAt: null } });
    if (!b) throw new HttpError(404, "Brand not found.", "not_found");
    return b;
  }
  const b = await getActiveBrand(user);
  if (!b) throw new HttpError(404, "No brand yet — create one first.", "no_brand");
  return b;
}

export async function parseJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body.", "bad_json");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(422, r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "validation");
  return r.data;
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Wraps a route handler: auth errors, app errors and provider errors become JSON with proper status. */
export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof AppError) return json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof ProviderError) return json({ error: err.message, code: `provider_${err.options.category}`, retryable: err.options.retryable }, { status: err.options.status === 429 ? 429 : 502 });
      if (err instanceof ZodError) return json({ error: err.message, code: "validation" }, { status: 422 });
      const e = err as Error & { code?: string };
      if (e.code === "P2025") return json({ error: "Not found.", code: "not_found" }, { status: 404 });
      console.error("[api]", e);
      return json({ error: process.env.NODE_ENV === "production" ? "Internal error." : e.message, code: "internal" }, { status: 500 });
    }
  };
}

/**
 * Job tick authentication. Accepts the CRON_SECRET (Vercel Cron, external pingers) or the token of
 * the database scheduler: that token is generated inside Postgres and only its SHA-256 is stored
 * in SystemSetting `jobs.tickTokenHash`, so the token itself never leaves the database.
 */
export async function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const q = new URL(req.url).searchParams.get("secret");
  if (expected && (bearer === expected || q === expected)) return;
  if (bearer) {
    const row = await prisma.systemSetting.findUnique({ where: { key: "jobs.tickTokenHash" } });
    const hash = typeof row?.value === "string" ? row.value : null;
    if (hash && hash.length === 64) {
      const got = createHash("sha256").update(bearer).digest();
      const want = Buffer.from(hash, "hex");
      if (got.length === want.length && timingSafeEqual(got, want)) return;
    }
  }
  if (!expected) throw new HttpError(500, "CRON_SECRET not configured.", "config");
  throw new HttpError(401, "Bad cron secret.", "unauthenticated");
}
