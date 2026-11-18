import { NextResponse } from "next/server";
import { completeOAuthCallback, parseProvider, appUrl } from "@sm/core";

/**
 * Provider redirect target. No session is required here: the single-use state binds the callback
 * to the brand the connection was started for. Choosing among several granted assets happens on
 * the next page, which does require the owner's session.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const qp = Object.fromEntries(url.searchParams.entries());
  try {
    const r = await completeOAuthCallback(parseProvider(provider), qp);
    if (r.pendingState) return NextResponse.redirect(`${appUrl()}/accounts/choose?state=${encodeURIComponent(r.pendingState)}`);
    return NextResponse.redirect(`${appUrl()}/connections?${r.reconnected ? "reconnected" : "connected"}=${r.accounts.length}&provider=${provider}`);
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message.slice(0, 400));
    return NextResponse.redirect(`${appUrl()}/connections?error=${msg}&provider=${provider}`);
  }
}
