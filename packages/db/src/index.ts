import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __smPrisma: PrismaClient | undefined;
}

function create(): PrismaClient {
  return new PrismaClient({
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/** Singleton Prisma client (survives Next.js dev hot reloads). */
export const prisma: PrismaClient = globalThis.__smPrisma ?? create();
if (process.env.NODE_ENV !== "production") globalThis.__smPrisma = prisma;

export type Db = PrismaClient;
