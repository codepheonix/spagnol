import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

export interface EncryptedBlob {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  keyVersion: number;
}

function loadKey(version = 1): Buffer {
  const envName = version === 1 ? "TOKEN_ENCRYPTION_KEY" : `TOKEN_ENCRYPTION_KEY_V${version}`;
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not set. Generate one with: openssl rand -base64 32`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${envName} must decode to exactly 32 bytes (got ${key.length}).`);
  return key;
}

export function currentKeyVersion(): number {
  return Number(process.env.TOKEN_ENCRYPTION_KEY_VERSION ?? "1");
}

/** AES-256-GCM encryption for provider credentials at rest. */
export function encryptSecret(plaintext: string, keyVersion = currentKeyVersion()): EncryptedBlob {
  const key = loadKey(keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function decryptSecret(blob: EncryptedBlob): string {
  const key = loadKey(blob.keyVersion);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, keyVersion?: number): EncryptedBlob {
  return encryptSecret(JSON.stringify(value), keyVersion);
}

export function decryptJson<T = unknown>(blob: EncryptedBlob): T {
  return JSON.parse(decryptSecret(blob)) as T;
}

// --- Passwords (scrypt, no external dependency) ---------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 })) as Buffer;
  return `scrypt$16384$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const derived = (await scrypt(password, salt, expected.length, { N, r, p })) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// --- Tokens & hashes ------------------------------------------------------------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function hmacSha256Base64(secret: string, payload: string | Buffer): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Redacts anything that looks like a token in a string meant for logs. */
export function redact(value: string): string {
  return value
    .replace(/(bot)?\d{6,}:[A-Za-z0-9_-]{30,}/g, "[redacted-bot-token]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, "Bearer [redacted]")
    .replace(/([?&](access_token|token|key|secret|password|apikey)=)[^&\s]+/gi, "$1[redacted]");
}
