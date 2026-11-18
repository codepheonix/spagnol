import { mfaEnabled } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { safeNext } from "@sm/security/redirect";
import { ConfirmForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const user = await requireUser();
  const { next } = await searchParams;
  return <ConfirmForm next={safeNext(next)} needsCode={mfaEnabled(user)} />;
}
