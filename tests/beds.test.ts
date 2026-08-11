import { describe, it, expect } from "vitest";
import { bedNumber, bedShort, bedLabel } from "@/lib/beds";

/**
 * The bug this file locks shut: every screen used to render `${ward} · ${bedNo}`
 * against a bedNo that already carried its ward, so the ICU read
 *
 *     ICU · ICU-02
 *
 * on bills, discharge summaries and the admission SMS. The fix derives the
 * label instead of storing it, so these cases are the contract - `bedNo` in the
 * database is untouched and must stay that way.
 */

describe("bedNumber - the bare number a ward calls a bed", () => {
  const cases: [string, string][] = [
    ["ICU-02", "2"],
    ["GW-10", "10"],
    ["SP-03", "3"],
    ["PR-01", "1"],
    ["ICU-12", "12"],
    // No separator, and a prefix that itself ends in a letter.
    ["ICU2", "2"],
    // Already bare.
    ["7", "7"],
    ["07", "7"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected}`, () => expect(bedNumber(input)).toBe(expected));
  }

  it("drops leading zeros - 'ICU-02' is a sort key, 'bed 2' is what the nurse says", () => {
    expect(bedNumber("ICU-02")).toBe("2");
    expect(bedNumber("GW-009")).toBe("9");
  });

  /**
   * A label that silently loses the bed is worse than an ugly one: a hospital
   * that names a bed "ISOLATION" must still see it on the ward board.
   */
  it("returns a non-numeric bed name untouched rather than blanking it", () => {
    expect(bedNumber("ISOLATION")).toBe("ISOLATION");
    expect(bedNumber("ICU-A")).toBe("ICU-A");
  });

  it("is empty for empty input, and never throws on null", () => {
    expect(bedNumber("")).toBe("");
    expect(bedNumber(null)).toBe("");
    expect(bedNumber(undefined)).toBe("");
  });

  /**
   * Anchored at the END on purpose. An unanchored match would read the 2 out of
   * "ICU2" style prefixes on a ward like "ICU2-05" and label bed 5 as bed 2.
   */
  it("takes the trailing number, never a digit from the prefix", () => {
    expect(bedNumber("ICU2-05")).toBe("5");
    expect(bedNumber("W3-11")).toBe("11");
  });
});

describe("bedShort - inside a screen already grouped by ward", () => {
  it("reads as BED n", () => {
    expect(bedShort("ICU-02")).toBe("BED 2");
    expect(bedShort("GW-10")).toBe("BED 10");
  });

  it("is empty for an empty bed rather than a dangling 'BED'", () => {
    expect(bedShort("")).toBe("");
    expect(bedShort(null)).toBe("");
  });
});

describe("bedLabel - what leaves the building", () => {
  it("is what the user asked for", () => {
    expect(bedLabel("ICU", "ICU-02")).toBe("ICU BED 2");
    expect(bedLabel("General Ward", "GW-07")).toBe("General Ward BED 7");
    expect(bedLabel("Sharing Room", "SP-02")).toBe("Sharing Room BED 2");
    expect(bedLabel("Special Room", "PR-04")).toBe("Special Room BED 4");
  });

  it("never says the ward twice", () => {
    // The whole point. "ICU · ICU-02" was the old output.
    const label = bedLabel("ICU", "ICU-02");
    expect(label).toBe("ICU BED 2");
    expect(label.match(/ICU/g)).toHaveLength(1);
  });

  it("degrades to whichever half it has, rather than rendering 'undefined'", () => {
    expect(bedLabel("ICU", "")).toBe("ICU");
    expect(bedLabel("", "ICU-02")).toBe("BED 2");
    expect(bedLabel("", "")).toBe("");
    expect(bedLabel(null, null)).toBe("");
  });

  it("tolerates the whitespace a hand-typed ward name arrives with", () => {
    expect(bedLabel("  ICU  ", " ICU-02 ")).toBe("ICU BED 2");
  });
});
