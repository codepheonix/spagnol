import { NextResponse } from "next/server";
import { completeOAuthCallback, parseProvider, appUrl } from "@sm/core";
import { getSessionUser } from "@/lib/auth";

/**
 * Provider redirect target. The single-use state names the workspace and the user who started the
 * connection; the browser finishing it must be signed in as that same user (the session cookie is
 * SameSite=Lax, so it is sent on this top-level return from the platform).
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const qp = Object.fromEntries(url.searchParams.entries());
  try {
    const user = await getSessionUser();
    const r = await completeOAuthCallback(parseProvider(provider), qp, user?.id ?? null);
    if (r.pendingState) return NextResponse.redirect(`${appUrl()}/accounts/choose?state=${encodeURIComponent(r.pendingState)}`);
    return NextResponse.redirect(`${appUrl()}/connections?${r.reconnected ? "reconnected" : "connected"}=${r.accounts.length}&provider=${provider}`);
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message.slice(0, 400));
    return NextResponse.redirect(`${appUrl()}/connections?error=${msg}&provider=${provider}`);
  }
}
