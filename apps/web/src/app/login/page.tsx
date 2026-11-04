import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { AuthShell } from "@/components/AuthShell";
import { getSessionUser } from "@/lib/auth";
import { getLocale, t } from "@/lib/i18n";
import { setupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  if ((await setupState().catch(() => ({ needsSetup: false }))).needsSetup) redirect("/setup");
  const tr = await t();
  const lang = await getLocale();
  return (
    <AuthShell lang={lang}>
      <Suspense>
        <LoginForm labels={{ email: tr("email"), password: tr("password"), login: tr("login"), title: lang === "it" ? "Accedi" : "Sign in", lead: lang === "it" ? "Account del titolare." : "Owner account." }} />
      </Suspense>
    </AuthShell>
  );
}
