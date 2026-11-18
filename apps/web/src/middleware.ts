import { NextResponse, type NextRequest } from "next/server";
import { verifySessionToken } from "@sm/security/session";

/** Reachable without a session. */
const PUBLIC = ["/login", "/setup", "/privacy", "/api/auth/login", "/api/auth/setup", "/api/health", "/api/webhooks", "/api/jobs/tick", "/api/oauth"];
/** Called by other servers, never by a browser form or script: no browser-origin check applies. Each authenticates itself (signature, secret, single-use state). */
const MACHINE = ["/api/webhooks", "/api/jobs/tick", "/api/oauth"];

const under = (list: string[], pathname: string) => list.some((p) => pathname === p || pathname.startsWith(p + "/"));

const originOf = (v: string | undefined) => {
  try {
    return v ? new URL(v).origin : null;
  } catch {
    return null;
  }
};

/**
 * Content Security Policy. Scripts run only from this site and only with this response's nonce, so
 * injected markup cannot execute. Inline style attributes are allowed (the interface and its
 * diagram and 3D libraries position things with them); styles cannot run code.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  // Uploads go straight from the browser to the storage service: allow exactly those origins.
  const storage = [process.env.MEDIA_GATEWAY_URL, process.env.S3_ENDPOINT, process.env.S3_PUBLIC_URL, process.env.CSP_CONNECT_EXTRA].map(originOf).filter(Boolean);
  if (process.env.STORAGE_DRIVER === "vercel-blob") storage.push("https://*.blob.vercel-storage.com", "https://vercel.com");
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${storage.join(" ")}${dev ? " ws: wss:" : ""}`.trim(),
    `worker-src 'self' blob:`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(dev ? [] : [`upgrade-insecure-requests`]),
  ].join("; ");
}

function secure(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  // API answers are data, never documents: they may load and run nothing.
  const nonce = isApi ? "" : btoa(crypto.randomUUID());
  const csp = isApi ? "default-src 'none'; frame-ancestors 'none'" : contentSecurityPolicy(nonce);
  const pass = () => {
    if (isApi) return secure(NextResponse.next(), csp);
    // Next.js reads the policy from the request to put the nonce on its own scripts.
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return secure(NextResponse.next({ request: { headers } }), csp);
  };

  // Cross-site request forgery: a state-changing call must come from this site's own pages. This
  // includes sign-in and first-run setup. Browsers always send Origin on such requests; a request
  // with no browser-origin headers at all (a server-side client) carries no ambient session risk
  // because the session cookie is SameSite=Lax.
  if (isApi && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && !under(MACHINE, pathname)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const site = req.headers.get("sec-fetch-site");
    const foreignOrigin = origin !== null && (origin === "null" || !host || originOf(origin) === null || new URL(origin).host !== host);
    if (foreignOrigin || site === "cross-site") return secure(NextResponse.json({ error: "Cross-origin request blocked.", code: "csrf" }, { status: 403 }), csp);
  }

  if (under(PUBLIC, pathname) || pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname === "/icon.svg") return pass();

  const token = req.cookies.get("sm_session")?.value;
  const claims = token ? await verifySessionToken(token) : null;
  if (!claims) {
    if (isApi) return secure(NextResponse.json({ error: "Not signed in.", code: "unauthenticated" }, { status: 401 }), csp);
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return secure(NextResponse.redirect(url), csp);
  }
  return pass();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
