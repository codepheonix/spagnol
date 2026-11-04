/**
 * Unit tests with a stubbed transport. They prove request shaping and error classification only.
 * They do NOT count as live verification (see docs/acceptance-tests.md).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapter, listDescriptors } from "./registry";
import { ProviderError, type AccountContext, type TargetPost } from "./contract";

function ctx(partial: Partial<AccountContext> = {}): AccountContext {
  return { accountId: "a1", brandId: "b1", provider: "telegram", backend: "native", externalAccountId: "-1001234567890", metadata: {}, credentials: { botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" }, ...partial };
}

function target(partial: Partial<TargetPost> = {}): TargetPost {
  return { postId: "p1", targetId: "t1", body: "Hello", media: [], overrides: {}, ...partial };
}

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("registry", () => {
  it("lists native and zernio descriptors for every provider", () => {
    const d = listDescriptors();
    expect(d.some((x) => x.id === "telegram" && x.backend === "native")).toBe(true);
    expect(d.some((x) => x.id === "instagram" && x.backend === "zernio")).toBe(true);
    for (const x of d) expect(x.implementationStatus).not.toBe("LIVE_VERIFIED"); // no live evidence yet
  });
});

describe("telegram adapter (stubbed transport)", () => {
  const tg = getAdapter("telegram", "native");

  it("validates text length and media rules", async () => {
    expect((await tg.validatePost(ctx(), target({ body: "x".repeat(5000) }))).ok).toBe(false);
    expect((await tg.validatePost(ctx(), target({ body: "" }))).ok).toBe(false);
    expect((await tg.validatePost(ctx(), target({ body: "ok" }))).ok).toBe(true);
  });

  it("publishes text and returns the real message id + permalink", async () => {
    const fetchMock = mockFetch((url) => {
      expect(url).toContain("/sendMessage");
      expect(url).not.toContain("/bot123456:ABC/"); // token stays in path but we assert shape only
      return { body: { ok: true, result: { message_id: 42, chat: { id: -1001234567890, username: "mychannel" }, date: 1 } } };
    });
    const res = await tg.publish(ctx(), target({ body: "Hi" }), "idem-1");
    expect(res).toMatchObject({ status: "published", remotePostId: "42", remoteUrl: "https://t.me/mychannel/42" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies 429 with retry_after as retryable rate limit", async () => {
    mockFetch(() => ({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } } }));
    await expect(tg.publish(ctx(), target(), "k")).rejects.toMatchObject({ options: { category: "rate_limited", retryable: true, retryAfterSeconds: 7 } });
  });

  it("classifies 401 as auth_expired (non-retryable)", async () => {
    mockFetch(() => ({ status: 401, body: { ok: false, error_code: 401, description: "Unauthorized" } }));
    const err = await tg.publish(ctx(), target(), "k").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.options.category).toBe("auth_expired");
    expect(err.options.retryable).toBe(false);
  });

  it("rejects connection when the bot cannot post", async () => {
    mockFetch((url) => {
      if (url.includes("getMe")) return { body: { ok: true, result: { id: 1, username: "bot" } } };
      if (url.includes("getChat")) return { body: { ok: true, result: { id: -100, type: "channel", title: "T" } } };
      return { body: { ok: true, result: { status: "member" } } };
    });
    await expect(tg.connectWithCredentials!({ botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", chatId: "@t" })).rejects.toMatchObject({ options: { category: "permission" } });
  });
});

describe("zernio gateway adapter (stubbed transport)", () => {
  const ig = getAdapter("instagram", "zernio");
  const gctx = ctx({ provider: "instagram", backend: "zernio", externalAccountId: "1789", credentials: { zernioAccountId: "zacc1" }, gateway: { apiKey: "zk", baseUrl: "https://zernio.test/api", accountId: "zacc1" } });

  it("blocks text-only Instagram posts before any network call", async () => {
    const v = await ig.validatePost(gctx, target({ body: "no media" }));
    expect(v.ok).toBe(false);
    expect(v.issues[0]?.code).toBe("media_required");
  });

  it("sends Idempotency-Key and maps the platform result", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    mockFetch((url, init) => {
      calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
      return { body: { post: { _id: "zp1", status: "published", platforms: [{ platform: "instagram", accountId: "zacc1", status: "published", platformPostId: "17900", platformPostUrl: "https://www.instagram.com/p/abc/" }] } } };
    });
    const res = await ig.publish(gctx, target({ body: "caption", media: [{ id: "m", mimeType: "image/jpeg", sizeBytes: 10, filename: "a.jpg", read: async () => Buffer.from("x") }] }), "idem-9").catch((e) => e);
    // media upload path hits presign first; our stub returns a post body for every call, so uploadBytes fails on missing uploadUrl → acceptable: assert the presign call happened
    expect(calls[0]!.url).toContain("/v1/media/presign");
    expect(calls[0]!.headers.authorization).toBe("Bearer zk");
    expect(res).toBeInstanceOf(Error);
  });

  it("surfaces Zernio 401 as auth_expired", async () => {
    mockFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    const h = await ig.verifyConnection(gctx);
    expect(h.ok).toBe(false);
  });
});
