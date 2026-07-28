import { describe, expect, it } from "vitest";
import { decodeBase64DataUrl } from "@/lib/data-url";

/**
 * This is what turns a stored branding image back into bytes a browser will
 * render. Getting the media type wrong serves a valid PNG that no browser
 * displays, which looks exactly like "the upload didn't save".
 */

// A 1x1 transparent PNG - the smallest real image there is.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("decodeBase64DataUrl", () => {
  it("splits a PNG data URI into its media type and bytes", () => {
    const out = decodeBase64DataUrl(`data:image/png;base64,${PNG_B64}`);
    expect(out).not.toBeNull();
    expect(out!.mime).toBe("image/png");
    // PNG magic number - proof we decoded an actual image, not just some bytes.
    expect([...out!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("keeps the compound media type of an SVG intact", () => {
    // "image/svg+xml" contains a '+' - a naive split on non-word characters
    // would truncate it to "image/svg" and the browser would refuse to render.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64");
    const out = decodeBase64DataUrl(`data:image/svg+xml;base64,${svg}`);
    expect(out!.mime).toBe("image/svg+xml");
    expect(out!.bytes.toString()).toContain("<svg");
  });

  it("handles an ICO, which is what most people already have to hand", () => {
    const out = decodeBase64DataUrl(`data:image/x-icon;base64,${PNG_B64}`);
    expect(out!.mime).toBe("image/x-icon");
  });

  it("survives a base64 payload wrapped across lines", () => {
    const wrapped = PNG_B64.slice(0, 40) + "\n" + PNG_B64.slice(40);
    const out = decodeBase64DataUrl(`data:image/png;base64,${wrapped}`);
    expect(out).not.toBeNull();
    expect([...out!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("returns null for null, undefined and empty input", () => {
    expect(decodeBase64DataUrl(null)).toBeNull();
    expect(decodeBase64DataUrl(undefined)).toBeNull();
    expect(decodeBase64DataUrl("")).toBeNull();
  });

  it("returns null rather than throwing on things that aren't data URIs", () => {
    // Callers serve decorative assets; the useful answer is a 404, not a 500.
    expect(decodeBase64DataUrl("https://example.com/icon.png")).toBeNull();
    expect(decodeBase64DataUrl("data:image/png,notbase64")).toBeNull();
    expect(decodeBase64DataUrl("just some text")).toBeNull();
  });

  it("returns null when the payload decodes to nothing", () => {
    expect(decodeBase64DataUrl("data:image/png;base64,####")).toBeNull();
  });
});
