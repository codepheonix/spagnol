import { prisma } from "@sm/db";

/** The sentinel hash an owner row carries when it was pre-created without a password (claim it at /setup). */
export const UNSET_PASSWORD = "UNSET";

export async function setupState(): Promise<{ needsSetup: boolean; claimEmail: string | null }> {
  const count = await prisma.user.count();
  if (count === 0) return { needsSetup: true, claimEmail: null };
  const unclaimed = await prisma.user.findFirst({ where: { passwordHash: UNSET_PASSWORD } });
  return { needsSetup: Boolean(unclaimed), claimEmail: unclaimed?.email ?? null };
}

