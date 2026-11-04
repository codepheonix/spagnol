import { NextResponse } from "next/server";
import { completeOAuthCallback, parseProvider, appUrl } from "@sm/core";

/** Provider redirect target. No session is required (state binds the callback to a brand). */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(req.url);
  const qp = Object.fromEntries(url.searchParams.entries());
  try {
    const r = await completeOAuthCallback(parseProvider(provider), qp);
    return NextResponse.redirect(`${appUrl()}/accounts?connected=${r.accounts.length}&provider=${provider}`);
  } catch (err) {
    const msg = encodeURIComponent((err as Error).message.slice(0, 300));
    return NextResponse.redirect(`${appUrl()}/accounts?error=${msg}&provider=${provider}`);
  }
}
