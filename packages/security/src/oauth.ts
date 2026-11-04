import { createHash, randomBytes } from "node:crypto";

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** Builds a URL with query params, dropping undefined values. */
export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** Exact redirect URI matching as required by most providers. */
export function redirectUriMatches(expected: string, actual: string): boolean {
  try {
    const a = new URL(expected);
    const b = new URL(actual);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
