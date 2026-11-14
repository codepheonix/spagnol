import Link from "next/link";
import { AppError, getPendingSelection } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { AccountChooser } from "@/components/Connections";
import { PROVIDER_NAME } from "@/lib/labels";

/** Step after the platform's sign-in: choose exactly which granted assets belong to the brand. */
export default async function ChooseAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const state = sp.state ?? "";
  let pending;
  try {
    pending = await getPendingSelection(user.id, state);
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return (
      <div>
        <h1>Choose accounts</h1>
        <div className="msg err">{e.message}</div>
        <Link href="/accounts" className="btn">Back to Connections</Link>
      </div>
    );
  }
  return (
    <div>
      <h1>Which accounts belong to {pending.brandName}?</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        You allowed access to the accounts below. Tick only the ones for <b>{pending.brandName}</b> — the others are not saved. This choice stays with {pending.brandName} even if you switched brand in another tab.
      </p>
      <AccountChooser state={state} brandName={pending.brandName} options={pending.options} providerNames={PROVIDER_NAME} />
    </div>
  );
}
