import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { del as blobDel, head as blobHead, list as blobList, put as blobPut } from "@vercel/blob";

export interface StorageDriver {
  readonly name: "local" | "s3" | "vercel-blob" | "supabase-edge";
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

/**
 * Vercel Blob driver. Objects are stored with `access: "public"` under an unguessable key
 * (brands/<brandId>/<date>/<uuid>-<name>), which is what networks that fetch media by URL
 * (Instagram) need. Private access is not used because the SDK has no signed-GET for it yet.
 */
class VercelBlobStorage implements StorageDriver {
  readonly name = "vercel-blob" as const;
  private urls = new Map<string, string>();
  private async urlFor(key: string): Promise<string | null> {
    const cached = this.urls.get(key);
    if (cached) return cached;
    const res = await blobList({ prefix: key, limit: 1 });
    const hit = res.blobs.find((b) => b.pathname === key);
    if (!hit) return null;
    this.urls.set(key, hit.url);
    return hit.url;
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    const res = await blobPut(key, bytes as unknown as Blob, { access: "public", addRandomSuffix: false, contentType, cacheControlMaxAge: 31_536_000 });
    this.urls.set(key, res.url);
  }
  async get(key: string) {
    const url = await this.urlFor(key);
    if (!url) throw new Error(`Blob ${key} not found.`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blob fetch failed (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(key: string) {
    const url = await this.urlFor(key);
    if (!url) return false;
    try {
      await blobHead(url);
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    const url = await this.urlFor(key);
    if (url) await blobDel(url);
    this.urls.delete(key);
  }
  async signedGetUrl(key: string) {
    return this.urlFor(key);
  }
  async signedPutUrl() {
    return null;
  }
}

/**
 * Supabase Storage through the `media` Edge Function (supabase/functions/media). The bucket is
 * private; the function holds the service-role key and is protected by a shared secret.
 * Browser-direct uploads use signed upload URLs, so large files bypass the web server.
 */
class SupabaseEdgeStorage implements StorageDriver {
  readonly name = "supabase-edge" as const;
  constructor(
    private readonly base: string,
    private readonly secret: string,
  ) {}
  private async call(method: string, action: string, key: string, extra: { query?: Record<string, string>; body?: BodyInit; contentType?: string } = {}): Promise<Response> {
    const u = new URL(`${this.base}/${action}`);
    u.searchParams.set("key", key);
    for (const [k, v] of Object.entries(extra.query ?? {})) u.searchParams.set(k, v);
    const headers: Record<string, string> = { "x-media-secret": this.secret };
    if (extra.contentType) headers["content-type"] = extra.contentType;
    const res = await fetch(u, { method, headers, body: extra.body });
    if (!res.ok) throw new Error(`media gateway ${method} ${action} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.call("PUT", "object", key, { body: new Uint8Array(bytes), contentType });
  }
  async get(key: string) {
    const res = await this.call("GET", "object", key);
    return Buffer.from(await res.arrayBuffer());
  }
  async exists(key: string) {
    const res = await this.call("GET", "head", key);
    return Boolean(((await res.json()) as { exists?: boolean }).exists);
  }
  async delete(key: string) {
    await this.call("DELETE", "object", key).catch(() => undefined);
  }
  async signedGetUrl(key: string, ttlSeconds = 3600) {
    const res = await this.call("POST", "sign-read", key, { query: { ttl: String(ttlSeconds) } });
    return ((await res.json()) as { url: string }).url;
  }
  async signedPutUrl(key: string) {
    const res = await this.call("POST", "sign-upload", key);
    return ((await res.json()) as { url: string }).url;
  }
}

let driver: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "supabase-edge") {
    const base = process.env.MEDIA_GATEWAY_URL;
    const secret = process.env.MEDIA_GATEWAY_SECRET;
    if (!base || !secret) throw new Error("MEDIA_GATEWAY_URL and MEDIA_GATEWAY_SECRET are required for the supabase-edge storage driver.");
    driver = new SupabaseEdgeStorage(base.replace(/\/$/, ""), secret);
  } else if (kind === "vercel-blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is required for the vercel-blob storage driver.");
    driver = new VercelBlobStorage();
  } else if (kind === "s3") {
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
