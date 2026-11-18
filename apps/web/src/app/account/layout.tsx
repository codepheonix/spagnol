import Link from "next/link";
import { requireUser, gatePath } from "@/lib/auth";
import { Wordmark } from "@/components/Logo";
import { LogoutButton } from "@/components/BrandSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security" };

/** The account's own screens. They stay reachable while the account is held at a required step, so they have no app navigation. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ gate: false });
  const held = gatePath(user) !== null;
  return (
    <div className="account">
      <header className="account-bar">
        <Wordmark href={held ? "/account/security" : "/"} />
        <span className="spacer" />
        {!held && <Link className="btn small" href="/">Back to iGerald</Link>}
        <ThemeToggle labels={{ dark: "Dark", light: "Light" }} />
        <LogoutButton label="Sign out" />
      </header>
      <main className="account-main">{children}</main>
    </div>
  );
}
