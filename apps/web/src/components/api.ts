"use client";

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  let body = init?.body;
  if (init?.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, credentials: "same-origin" });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`) as Error & { code?: string; status?: number };
    err.code = (data as { code?: string })?.code;
    err.status = res.status;
    // The server decides when a step is owed; the page only follows it.
    const here = `${window.location.pathname}${window.location.search}`;
    const go: Record<string, string> = { reauth_required: `/account/confirm?next=${encodeURIComponent(here)}`, password_change_required: "/account/password", mfa_setup_required: "/account/security" };
    if (err.code && go[err.code] && !window.location.pathname.startsWith("/account/")) window.location.assign(go[err.code]!);
    throw err;
  }
  return data as T;
}
