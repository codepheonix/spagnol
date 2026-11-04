import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Signed GET URL readable by third parties for a short time (null when unsupported). */
  signedGetUrl(key: string, ttlSeconds?: number): Promise<string | null>;
  /** Signed PUT URL for browser-direct uploads (null when unsupported). */
  signedPutUrl(key: string, contentType: string, ttlSeconds?: number): Promise<string | null>;
}

class LocalStorage implements StorageDriver {
  readonly name = "local" as const;
  constructor(private readonly root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error("Invalid storage key.");
    return p;
  }
  async put(key: string, bytes: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  get(key: string) {
    return readFile(this.path(key));
  }
  async exists(key: string) {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async signedGetUrl() {
    return null;
  }
  async signedPutUrl() {
    return null;
  }
}

class S3Storage implements StorageDriver {
  readonly name = "s3" as const;
  private client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: process.env.STORAGE_REGION ?? "us-east-1",
      endpoint: process.env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? "true") === "true",
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "", secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "" },
    });
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body.`);
    return Buffer.from(bytes);
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  signedGetUrl(key: string, ttlSeconds = 3600) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
  signedPutUrl(key: string, contentType: string, ttlSeconds = 900) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSeconds });
  }
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "s3") {
    const bucket = process.env.STORAGE_BUCKET;
    if (!bucket) throw new Error("STORAGE_BUCKET is required for the s3 storage driver.");
    driver = new S3Storage(bucket);
  } else {
    driver = new LocalStorage(process.env.STORAGE_LOCAL_DIR ?? join(process.cwd(), "data", "media"));
  }
  return driver;
}

/** For tests. */
export function __setStorage(d: StorageDriver | undefined) {
  driver = d;
}
