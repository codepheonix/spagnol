import { redirect } from "next/navigation";
import { mailConfigured } from "@sm/core";
import { AuthShell } from "@/components/AuthShell";
import { ForgotForm } from "@/components/AccountForms";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function ForgotPage() {
  if (await getSessionUser()) redirect("/account/password");
  return (
    <AuthShell lang={await getLocale()}>
      <ForgotForm mail={mailConfigured()} />
    </AuthShell>
  );
}
