import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { ResetForm } from "@/components/AccountForms";
import { getLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";
// The link carries a secret: never send it on to another site in a Referer header.
export const metadata = { referrer: "no-referrer" as const };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell lang={await getLocale()}>
      {token && token.length >= 20 ? <ResetForm token={token} /> : <div className="card"><h1>This link is not complete</h1><p className="lead">Open the link from the e-mail again, or ask for a new one.</p><Link className="small" href="/forgot">Ask for a new link</Link></div>}
    </AuthShell>
  );
}
