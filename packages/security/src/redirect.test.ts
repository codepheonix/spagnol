import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("post-sign-in destination", () => {
  it("keeps paths on this site", () => {
    for (const ok of ["/", "/posts", "/posts/abc?tab=1#x", "/account/security?changed=1"]) expect(safeNext(ok)).toBe(ok);
  });
  it("refuses anything a browser could read as another site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "http:/evil", "javascript:alert(1)", "evil.example", "", null, undefined, "/ok\nSet-Cookie: x", "\\/evil.example", " /posts"]) expect(safeNext(bad as string | null), String(bad)).toBe("/");
    expect(safeNext("//evil.example", "/home")).toBe("/home");
  });
});
