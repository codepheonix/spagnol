/**
 * Bluesky adapter and the outbound-address guard, with a stubbed transport. These prove request
 * shaping, refusal of unsafe server addresses and error classification — not Bluesky's acceptance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAdapter } from "./registry";
import { ProviderError, type AccountContext, type TargetPost } from "./contract";
import { assertPublicHttpsUrl, ipIsPublic, readLimited, resolver } from "./net";
import { detectFacets, graphemeLength } from "./bluesky/index";

const adapter = getAdapter("bluesky", "native");
const ctx = (credentials: Record<string, string> = { identifier: "sam.example.com", appPassword: "abcd-efgh-ijkl-mnop" }): AccountContext => ({ accountId: "a1", brandId: "b1", provider: "bluesky", backend: "native", externalAccountId: "did:plc:me", metadata: {}, credentials });
const target = (p: Partial<TargetPost> = {}): TargetPost => ({ postId: "p1", targetId: "t1", body: "Hello", media: [], overrides: {}, ...p });

type Call = { url: URL; method: string; headers: Record<string, string>; body: unknown; redirect?: string };
let calls: Call[] = [];
type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };
function serve(routes: Record<string, (c: Call) => Answer>) {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const raw = init?.body;
    const c: Call = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: typeof raw === "string" ? JSON.parse(raw) : raw, redirect: init?.redirect };
    calls.push(c);
    const nsid = url.pathname.replace("/xrpc/", "");
    const r: Answer = (routes[nsid] ?? (() => ({ status: 404, body: { error: "MethodNotImplemented" } })))(c);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }));
}
const session = () => ({ body: { accessJwt: "jwt-1", did: "did:plc:me", handle: "sam.example.com" } });

beforeEach(() => {
  calls = [];
  vi.spyOn(resolver, "lookup").mockImplementation(async (host: string) => (host === "pds.internal-trick.example" ? [{ address: "10.0.0.5", family: 4 }] : host === "meta.example" ? [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("outbound-address guard", () => {
  it("classifies private, loopback, link-local, metadata and mapped addresses as not public", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "not-an-ip"]) expect(ipIsPublic(ip), ip).toBe(false);
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700:4700::1111"]) expect(ipIsPublic(ip), ip).toBe(true);
  });
  it("refuses http, IP literals, credentials, odd ports, internal names and names that resolve to a private address", async () => {
    for (const bad of ["http://bsky.social", "https://127.0.0.1", "https://[::1]", "https://169.254.169.254/latest/meta-data", "https://user:pw@bsky.social", "https://bsky.social:8443", "https://localhost", "https://db.internal", "https://printer.local", "https://pds.internal-trick.example", "https://meta.example", "file:///etc/passwd", "gopher://x.example", "nonsense"]) {
      await expect(assertPublicHttpsUrl(bad), bad).rejects.toBeInstanceOf(ProviderError);
    }
    expect((await assertPublicHttpsUrl("https://bsky.social")).origin).toBe("https://bsky.social");
  });
  it("stops reading an answer that is larger than the limit", async () => {
    await expect(readLimited(new Response("x".repeat(5000)), 1000)).rejects.toThrow(/too large/);
    await expect(readLimited(new Response("x", { headers: { "content-length": "999999999" } }), 1000)).rejects.toThrow(/too large/);
    expect((await readLimited(new Response("ok"), 1000)).byteLength).toBe(2);
  });
});

describe("bluesky adapter", () => {
  it("never contacts a server address that fails the guard", async () => {
    serve({});
    await expect(adapter.connectWithCredentials!({ identifier: "sam.example.com", appPassword: "x", service: "https://pds.internal-trick.example" })).rejects.toThrow(/private network/);
    await expect(adapter.connectWithCredentials!({ identifier: "sam.example.com", appPassword: "x", service: "http://169.254.169.254" })).rejects.toThrow(/cannot be used/);
    const health = await adapter.verifyConnection(ctx({ identifier: "a", appPassword: "b", service: "https://127.0.0.1" }));
    expect(health.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("connects with an app password, refuses redirects, and reports a rejected password as an authorization failure", async () => {
    serve({ "com.atproto.server.createSession": session, "app.bsky.actor.getProfile": () => ({ body: { displayName: "Sam", avatar: "https://cdn.example/a.jpg" } }) });
    const r = await adapter.connectWithCredentials!({ identifier: "@sam.example.com", appPassword: " abcd " });
    expect(r.accounts[0]).toMatchObject({ externalAccountId: "did:plc:me", username: "sam.example.com", displayName: "Sam" });
    expect(calls[0]!.url.origin).toBe("https://bsky.social");
    expect(calls[0]!.body).toEqual({ identifier: "sam.example.com", password: "abcd" });
    expect(calls.every((c) => c.redirect === "error")).toBe(true);
    expect(calls[1]!.headers.authorization).toBe("Bearer jwt-1");
    serve({ "com.atproto.server.createSession": () => ({ status: 401, body: { error: "AuthenticationRequired", message: "Invalid identifier or password" } }) });
    await expect(adapter.connectWithCredentials!({ identifier: "sam.example.com", appPassword: "bad" })).rejects.toMatchObject({ options: { category: "auth_expired", retryable: false } });
  });

  it("publishes text with link, tag and mention facets at UTF-8 byte offsets, and states a language only when given", async () => {
    serve({
      "com.atproto.server.createSession": session,
      "com.atproto.identity.resolveHandle": (c) => (c.url.searchParams.get("handle") === "friend.example.com" ? { body: { did: "did:plc:friend" } } : { status: 400, body: { error: "InvalidRequest" } }),
      "com.atproto.repo.createRecord": () => ({ body: { uri: "at://did:plc:me/app.bsky.feed.post/3kabc", cid: "bafy1" } }),
    });
    const body = "Caffè ☕ with @friend.example.com and @nobody.invalid #launch";
    const res = await adapter.publish(ctx(), target({ body, link: "https://example.com/a?b=1." }), "k1");
    expect(res).toMatchObject({ status: "published", remotePostId: "at://did:plc:me/app.bsky.feed.post/3kabc", remoteUrl: "https://bsky.app/profile/sam.example.com/post/3kabc" });
    const sent = (calls.find((c) => c.url.pathname.endsWith("createRecord"))!.body as { repo: string; record: { text: string; facets: Array<{ index: { byteStart: number; byteEnd: number }; features: Array<Record<string, string>> }>; langs?: string[] } });
    expect(sent.repo).toBe("did:plc:me");
    expect(sent.record.langs).toBeUndefined();
    const bytes = new TextEncoder().encode(sent.record.text);
    const slice = (f: { index: { byteStart: number; byteEnd: number } }) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    const kinds = sent.record.facets.map((f) => [f.features[0]!.$type!.split("#")[1], slice(f)]);
    expect(kinds).toEqual([["mention", "@friend.example.com"], ["tag", "#launch"], ["link", "https://example.com/a?b=1"]]); // the unresolved mention stays plain text; trailing dot is not part of the link
    expect(sent.record.facets[0]!.features[0]!.did).toBe("did:plc:friend");
  });

  it("uploads images as blobs with their type and embeds them", async () => {
    serve({ "com.atproto.server.createSession": session, "com.atproto.repo.uploadBlob": () => ({ body: { blob: { $type: "blob", ref: { $link: "bafyimg" }, mimeType: "image/png", size: 3 } } }), "com.atproto.repo.createRecord": () => ({ body: { uri: "at://did:plc:me/app.bsky.feed.post/3kimg", cid: "c" } }) });
    await adapter.publish(ctx(), target({ media: [{ id: "m1", filename: "a.png", mimeType: "image/png", sizeBytes: 3, altText: "A chair", width: 4, height: 3, read: async () => Buffer.from([1, 2, 3]), url: async () => "https://x.example/a.png" } as never] }), "k2");
    const up = calls.find((c) => c.url.pathname.endsWith("uploadBlob"))!;
    expect(up.headers["content-type"]).toBe("image/png");
    const rec = (calls.find((c) => c.url.pathname.endsWith("createRecord"))!.body as { record: { embed: { $type: string; images: Array<{ alt: string; aspectRatio: unknown; image: { ref: { $link: string } } }> } } }).record;
    expect(rec.embed.$type).toBe("app.bsky.embed.images");
    expect(rec.embed.images[0]).toMatchObject({ alt: "A chair", aspectRatio: { width: 4, height: 3 }, image: { ref: { $link: "bafyimg" } } });
  });

  it("counts characters as people see them and enforces the limits", async () => {
    expect(graphemeLength("👨‍👩‍👧‍👦é")).toBe(2);
    const v = await adapter.validatePost(ctx(), target({ body: "x".repeat(301) }));
    expect(v.ok).toBe(false);
    expect((await adapter.validatePost(ctx(), target({ body: "👍".repeat(300) }))).ok).toBe(true);
    expect((await detectFacets("#1 is not a tag, #ok is", async () => null)).map((f) => f.features[0]!.tag)).toEqual(["ok"]);
  });

  it("deletes only a post in the signed-in account's own repository; rate limits are retryable", async () => {
    serve({ "com.atproto.server.createSession": session, "com.atproto.repo.deleteRecord": () => ({ body: {} }) });
    await expect(adapter.deletePost!(ctx(), "at://did:plc:someone-else/app.bsky.feed.post/3kzzz")).rejects.toThrow(/does not belong/);
    expect(calls.some((c) => c.url.pathname.endsWith("deleteRecord"))).toBe(false);
    await adapter.deletePost!(ctx(), "at://did:plc:me/app.bsky.feed.post/3kabc");
    expect(calls.find((c) => c.url.pathname.endsWith("deleteRecord"))!.body).toEqual({ repo: "did:plc:me", collection: "app.bsky.feed.post", rkey: "3kabc" });
    serve({ "com.atproto.server.createSession": () => ({ status: 429, body: { error: "RateLimitExceeded" }, headers: { "retry-after": "17" } }) });
    await expect(adapter.publish(ctx(), target(), "k3")).rejects.toMatchObject({ options: { category: "rate_limited", retryable: true, retryAfterSeconds: 17 } });
  });

  it("reads metrics from the provider and leaves missing numbers empty", async () => {
    serve({ "com.atproto.server.createSession": session, "app.bsky.actor.getProfile": () => ({ body: { followersCount: 12 } }), "app.bsky.feed.getAuthorFeed": () => ({ body: { feed: [{ post: { uri: "at://did:plc:me/app.bsky.feed.post/1", cid: "c", author: { did: "did:plc:me", handle: "sam.example.com" }, record: {}, indexedAt: "2026-01-01T00:00:00Z", likeCount: 3 } }] } }) });
    const m = await adapter.fetchMetrics!(ctx(), { from: new Date(0), to: new Date() });
    expect(m.find((x) => x.metric === "followers")!.value).toBe(12);
    expect(m.find((x) => x.metric === "following")!.value).toBeNull(); // absent is not zero
    expect(m.find((x) => x.metric === "likes")!.value).toBe(3);
    expect(m.find((x) => x.metric === "quotes")!.value).toBeNull();
    expect(m.every((x) => x.source.startsWith("native:app.bsky."))).toBe(true);
  });
});
