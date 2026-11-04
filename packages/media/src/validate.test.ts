import { describe, expect, it } from "vitest";
import { probeMedia, safeFilename, sniffMime } from "./validate";

const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("media validation", () => {
  it("detects PNG and reads dimensions", () => {
    expect(sniffMime(PNG_1x1)).toBe("image/png");
    const p = probeMedia(PNG_1x1, "image/png");
    expect(p).toMatchObject({ ok: true, width: 1, height: 1 });
  });
  it("rejects mismatched declared type", () => {
    expect(probeMedia(PNG_1x1, "video/mp4").ok).toBe(false);
  });
  it("rejects unknown content", () => {
    expect(probeMedia(Buffer.from("MZ\x90\x00this is not an image at all"), "image/png").ok).toBe(false);
  });
  it("sanitises filenames", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("my photo (1).JPG")).toBe("my_photo_1_.JPG");
  });
});
