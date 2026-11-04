import { SignJWT, jwtVerify } from "jose";

const ISSUER = "social-manager";

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) throw new Error("AUTH_SECRET must be set (at least 16 characters).");
  return new TextEncoder().encode(raw);
}

export interface SessionClaims {
  sub: string; // user id
  sid: string; // session id (db)
}

export async function signSessionToken(claims: SessionClaims, ttlSeconds: number): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    if (!payload.sub || typeof payload.sid !== "string") return null;
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    return null;
  }
}
