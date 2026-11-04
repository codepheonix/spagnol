import { beforeAll, describe, expect, it } from "vitest";
import { decryptJson, encryptJson, hashPassword, redact, verifyPassword } from "./crypto";
import { verifyHmacSignature } from "./webhooks";
import { createHmac, randomBytes } from "node:crypto";
import { signSessionToken, verifySessionToken } from "./session";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.AUTH_SECRET = randomBytes(32).toString("base64");
});

describe("credential encryption", () => {
  it("round-trips JSON and never stores plaintext", () => {
    const blob = encryptJson({ accessToken: "secret-123", refreshToken: "r" });
    expect(blob.ciphertext).not.toContain("secret-123");
    expect(decryptJson<{ accessToken: string }>(blob).accessToken).toBe("secret-123");
  });
  it("fails on tampering", () => {
    const blob = encryptJson({ a: 1 });
    const tampered = { ...blob, ciphertext: Buffer.from("x".repeat(8)).toString("base64") };
    expect(() => decryptJson(tampered)).toThrow();
  });
});

describe("passwords", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("webhook signatures", () => {
  it("accepts hex and sha256= prefixed", () => {
    const body = '{"id":"evt_1"}';
    const hex = createHmac("sha256", "s3cr3t").update(body).digest("hex");
    expect(verifyHmacSignature("s3cr3t", body, hex)).toBe(true);
    expect(verifyHmacSignature("s3cr3t", body, `sha256=${hex}`)).toBe(true);
    expect(verifyHmacSignature("s3cr3t", body, "deadbeef")).toBe(false);
    expect(verifyHmacSignature("other", body, hex)).toBe(false);
  });
});

describe("sessions", () => {
  it("signs and verifies, rejects expired", async () => {
    const token = await signSessionToken({ sub: "u1", sid: "s1" }, 60);
    expect(await verifySessionToken(token)).toEqual({ sub: "u1", sid: "s1" });
    const expired = await signSessionToken({ sub: "u1", sid: "s1" }, -10);
    expect(await verifySessionToken(expired)).toBeNull();
  });
});

describe("redact", () => {
  it("hides bot tokens and bearer tokens", () => {
    expect(redact("https://api.telegram.org/bot123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0/sendMessage")).not.toContain("AAHfiq");
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("[redacted]");
  });
});
