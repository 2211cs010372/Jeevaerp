import { describe, it, expect } from "vitest";
import { fitScale } from "@/lib/print/fit-page";

/**
 * THE SHEET OF PAPER SPENT ON TWO RULED LINES.
 *
 * A discharge summary that ran a centimetre past the bottom of page one printed
 * ONLY the two signatures and the footer on page two - six lines on a sheet the
 * ward then had to staple, file and photocopy along with the rest. It happens
 * because the sign-off carries `break-inside: avoid`, which is right (a
 * signature split down the middle is worse), so the whole block moves instead
 * of splitting.
 *
 * fitScale answers one question: what zoom makes this document fill a WHOLE
 * number of pages? Squeeze a little, save a sheet. Squeeze a lot and the
 * summary stops being readable, which on a medico-legal document is the worse
 * of the two failures - so there is a floor, and past it the extra page stays.
 *
 * P is the printable page height, H the document's natural height, T the table
 * header every page after the first repeats.
 */

const P = 1000;   // one page of room
const T = 60;     // the repeated header

describe("a summary that already fits", () => {
  it("leaves a short summary alone", () => {
    expect(fitScale(400, T, P)).toBe(1);
  });

  it("leaves one that exactly fills the page alone", () => {
    expect(fitScale(1000, T, P)).toBe(1);
  });

  it("never ENLARGES a short summary to fill the sheet", () => {
    // A half-page discharge is a half-page discharge. Blowing it up to fill A4
    // would be inventing emphasis the doctor did not write.
    expect(fitScale(120, T, P)).toBe(1);
  });
});

describe("the orphan signature page", () => {
  it("squeezes a summary that overruns by a signature block onto one page", () => {
    // The reported case: ~10% over, which is about what the sign-off measures.
    const s = fitScale(1100, T, P);
    expect(s).toBeCloseTo(1000 / 1100, 5);
    expect(1100 * s).toBeLessThanOrEqual(P + 0.001);
  });

  it("squeezes the worst overrun it is allowed to", () => {
    // 1/0.84 = 1.19 pages, the most that may be pulled back to one.
    const s = fitScale(1190, T, P);
    expect(s).toBeGreaterThanOrEqual(0.84);
    expect(1190 * s).toBeLessThanOrEqual(P + 0.001);
  });

  it("refuses to squeeze past legibility, and keeps the second page", () => {
    // 1.35 pages would need 0.74 - about 8.5px body text on paper handed to a
    // patient, an insurer and the next doctor. The sheet is the cheaper loss.
    expect(fitScale(1350, T, P)).toBe(1);
  });

  it("does the same trick on the second fold, not just the first", () => {
    // Two pages plus a signature block. Capacity for 2 pages is 2P - T.
    const s = fitScale(2000, T, P);
    expect(s).toBeLessThan(1);
    expect(2000 * s).toBeLessThanOrEqual(2 * P - T * s + 0.001);
  });
});

describe("the repeated header is paid for on every page after the first", () => {
  it("is ignored when the document fits on one page", () => {
    // Page one carries the header inside its own height already.
    expect(fitScale(1100, 0, P)).toBeCloseTo(fitScale(1100, T, P), 5);
  });

  it("makes a two-page target tighter than a naive halving would", () => {
    const withHeader = fitScale(2100, T, P);
    const without = fitScale(2100, 0, P);
    expect(withHeader).toBeLessThan(without);
  });
});

describe("nothing here divides by zero", () => {
  it("leaves an unmeasured document alone", () => {
    // The first render, before layout has happened.
    expect(fitScale(0, 0, P)).toBe(1);
    expect(fitScale(500, T, 0)).toBe(1);
  });

  it("survives a negative or NaN measurement rather than scaling to nothing", () => {
    expect(fitScale(-10, T, P)).toBe(1);
    expect(fitScale(Number.NaN, T, P)).toBe(1);
    expect(fitScale(500, T, Number.NaN)).toBe(1);
  });

  it("gives up rather than looping on an absurdly long document", () => {
    // A measurement gone wrong must not spin the page-count search.
    expect(fitScale(1e9, T, P)).toBe(1);
  });
});
