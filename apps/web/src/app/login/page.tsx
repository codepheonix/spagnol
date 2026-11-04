import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSessionUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { setupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  if ((await setupState().catch(() => ({ needsSetup: false }))).needsSetup) redirect("/setup");
  const tr = await t();
  return (
    <div className="login">
      <h1>Social Manager</h1>
      <Suspense>
        <LoginForm labels={{ email: tr("email"), password: tr("password"), login: tr("login") }} />
      </Suspense>
    </div>
  );
}
