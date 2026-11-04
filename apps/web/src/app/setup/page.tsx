import { redirect } from "next/navigation";
import { prisma } from "@sm/db";
import { SetupForm } from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <div className="login">
      <h1>First-run setup</h1>
      <p className="muted small">Creates the single owner account. This page disappears once an owner exists.</p>
      <SetupForm />
    </div>
  );
}
