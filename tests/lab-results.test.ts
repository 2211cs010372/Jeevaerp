import { describe, expect, it } from "vitest";
import { formatRange, type LabResultRow } from "@/components/portal/ui/lab-results";

/**
 * The reference range is the only thing on a result sheet that tells a reader
 * whether a number is good or bad. Getting it wrong doesn't crash anything - it
 * silently reassures someone about a value that should have worried them - so
 * every branch is pinned here.
 */

const range = (r: Partial<Pick<LabResultRow, "refLow" | "refHigh" | "refText">>) =>
  formatRange({ refLow: null, refHigh: null, refText: null, ...r });

describe("formatRange", () => {
  it("shows both bounds when the analyte has a two-sided range", () => {
    expect(range({ refLow: "13.0", refHigh: "17.0" })).toBe("13.0 - 17.0");
  });

  it("reads as a floor when only a lower bound is known", () => {
    expect(range({ refLow: "40" })).toBe("> 40");
  });

  it("reads as a ceiling when only an upper bound is known", () => {
    expect(range({ refHigh: "200" })).toBe("< 200");
  });

  it("falls back to the text range for results that aren't numbers", () => {
    expect(range({ refText: "Negative" })).toBe("Negative");
  });

  it("prefers the numeric range over a text one when both are present", () => {
    // A row carrying both is a template that was edited; the numbers are the
    // stricter statement and the one the flag was computed against.
    expect(range({ refLow: "0", refHigh: "5", refText: "Nil" })).toBe("0 - 5");
  });

  it("renders a dash when the lab recorded no range at all", () => {
    // Common for descriptive analytes. Must not print "null" or "undefined"
    // on a sheet a patient reads.
    expect(range({})).toBe("-");
  });

  it("treats a zero bound as a real bound, not a missing one", () => {
    // "0" is falsy as a number but is a legitimate lower bound; a truthiness
    // check here would silently drop it and show "< 5" instead of "0 - 5".
    expect(range({ refLow: "0", refHigh: "5" })).toBe("0 - 5");
  });
});
