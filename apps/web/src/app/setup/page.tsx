import { redirect } from "next/navigation";
import { SetupForm } from "@/components/LoginForm";
import { AuthShell } from "@/components/AuthShell";
import { setupState } from "@/lib/setup";
import { getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await setupState();
  if (!state.needsSetup) redirect("/login");
  const lang = await getLocale();
  return (
    <AuthShell lang={lang}>
      <SetupForm claimEmail={state.claimEmail} lang={lang} />
    </AuthShell>
  );
}
