import { passwordChangeOwed } from "@sm/core";
import { requireUser } from "@/lib/auth";
import { PasswordChangeForm } from "@/components/AccountForms";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const user = await requireUser({ gate: false });
  return (
    <div>
      <h1>Password</h1>
      <p className="muted">{user.email}</p>
      <PasswordChangeForm forced={passwordChangeOwed(user)} next="/account/security?changed=1" />
    </div>
  );
}
