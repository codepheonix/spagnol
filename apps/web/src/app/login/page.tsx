import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@sm/db";
import { LoginForm } from "@/components/LoginForm";
import { getSessionUser } from "@/lib/auth";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  if ((await prisma.user.count().catch(() => 1)) === 0) redirect("/setup");
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
