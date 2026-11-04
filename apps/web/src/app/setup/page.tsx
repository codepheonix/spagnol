import { redirect } from "next/navigation";
import { SetupForm } from "@/components/LoginForm";
import { setupState } from "@/lib/setup";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const state = await setupState();
  if (!state.needsSetup) redirect("/login");
  return (
    <div className="login">
      <h1>{state.claimEmail ? "Choose your password" : "First-run setup"}</h1>
      <p className="muted small">{state.claimEmail ? `The owner account ${state.claimEmail} is reserved for you. Set its password now; this page disappears afterwards.` : "Creates the single owner account. This page disappears once an owner exists."}</p>
      <SetupForm claimEmail={state.claimEmail} />
    </div>
  );
}
