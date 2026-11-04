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
  if (password.length < 10) throw new Error("OWNER_PASSWORD must be at least 10 characters.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await hashPassword(password),
        timezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Rome",
        locale: process.env.DEFAULT_LOCALE ?? "it",
      },
    });
    await prisma.brand.create({
      data: { ownerId: user.id, name: "Default brand", slug: "default", timezone: user.timezone, locale: user.locale },
    });
    console.log(`Owner created: ${email} (with a default brand).`);
  } else if (process.env.OWNER_RESET_PASSWORD === "1") {
    await prisma.user.update({ where: { email }, data: { passwordHash: await hashPassword(password) } });
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
