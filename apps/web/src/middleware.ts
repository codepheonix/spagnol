import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@sm/security/session";

const PUBLIC = ["/login", "/setup", "/api/auth/login", "/api/auth/setup", "/api/health", "/api/webhooks", "/api/jobs/tick", "/api/oauth"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/")) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  // CSRF: mutating API calls must come from our own origin (cookies are SameSite=Lax as well).
  if (pathname.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin request blocked.", code: "csrf" }, { status: 403 });
  }
  const token = req.cookies.get("sm_session")?.value;
  const claims = token ? await verifySessionToken(token) : null;
  if (!claims) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in.", code: "unauthenticated" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
