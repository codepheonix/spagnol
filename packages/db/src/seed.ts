/**
 * Seeds the single owner account from OWNER_EMAIL / OWNER_PASSWORD (hashed with scrypt).
 * Safe to re-run: updates the password only when OWNER_RESET_PASSWORD=1.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), "../../.env.local") });
config({ path: resolve(process.cwd(), ".env") });
import { prisma } from "./index";
import { hashPassword } from "@sm/security";

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "Owner";
  if (!email || !password) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD must be set (in .env, not in chat).");
  }
  if (password.length < 12) throw new Error("OWNER_PASSWORD must be at least 12 characters.");

  // A password that arrives through the environment is known to whoever set it up. On a real
  // deployment the owner must replace it at first sign-in; on a local machine it may stay.
  const local = !process.env.VERCEL && process.env.NODE_ENV !== "production" && !/^(production|preview)$/.test(process.env.APP_ENV ?? "");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        timezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Rome",
        locale: "en",
        passwordChangedAt: local ? new Date() : null,
      },
    });
    // No workspace is seeded: a new installation starts neutral and the owner adds their own.
    console.log(`Owner created: ${email} (no workspace yet — create one after signing in).`);
  } else if (process.env.OWNER_RESET_PASSWORD === "1") {
    await prisma.user.update({ where: { email }, data: { passwordHash: await hashPassword(password), passwordChangedAt: local ? new Date() : null, mustChangePassword: !local } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`Owner password reset for ${email}; all sessions revoked.`);
  } else {
    console.log(`Owner ${email} already exists. Set OWNER_RESET_PASSWORD=1 to reset the password.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
