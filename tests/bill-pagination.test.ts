import { describe, it, expect } from "vitest";
import { billPageStarts, type SheetMetrics } from "@/lib/bill-pagination";
import { pageSlices } from "@/lib/lab-pagination";

/**
 * The one thing a paginated bill must never do is lose a line between two
 * half-sheets that both look complete - while the Net Payable still counts it.
 * Most of these tests are that invariant stated from a different angle.
 *
 * The metrics are round numbers chosen to make the arithmetic checkable by eye:
 * 500px of paper, 200px of masthead-and-header on every sheet, a 100px totals
 * block on the sheet that ends the bill and a 20px carried-forward strip on the
 * ones that don't. So a continuation sheet holds 280px of rows and the last one
 * holds 200px.
 */
const M: SheetMetrics = { paper: 500, overhead: 200, endFoot: 100, contFoot: 20 };

/** Every item lands on exactly one sheet, in order. */
function tiles(starts: number[], rowCount: number): boolean {
  const seen = pageSlices(starts, rowCount).flatMap(({ start, end }) =>
    Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i));
  return seen.length === rowCount && seen.every((v, i) => v === i);
}

/** The tallest any sheet stands, given where the breaks landed. */
function tallest(starts: number[], rows: number[], m: SheetMetrics): number {
  return Math.max(...pageSlices(starts, rows.length).map(({ start, end }, k, all) => {
    const foot = k === all.length - 1 ? m.endFoot : m.contFoot;
    return m.overhead + foot + rows.slice(start, end).reduce((a, b) => a + b, 0);
  }));
}

const rows = (n: number, h = 20) => Array.from({ length: n }, () => h);

describe("billPageStarts", () => {
  it("keeps a short bill on one sheet", () => {
    // 10 rows x 20px = 200px, exactly the last sheet's capacity.
    expect(billPageStarts(rows(10), M)).toEqual([0]);
  });

  it("keeps a bill with no items on one sheet", () => {
    expect(billPageStarts([], M)).toEqual([0]);
  });

  it("breaks as soon as the totals no longer fit beside the lines", () => {
    // 11 rows is 220px - past the 200px a sheet carrying the totals can hold.
    // The first sheet fills to the roomier continuation capacity instead.
    expect(billPageStarts(rows(11), M)).toEqual([0, 10]);
  });

  it("fills a continuation sheet to the continuation capacity, not the last sheet's", () => {
    // 280px of rows = 14 per continuing sheet. Filling to 200px, the capacity
    // of a sheet that carries the totals, is the bug this replaced: it wasted a
    // quarter of every sheet and turned a 34-line bill into seven of them.
    // 14 and 14, then the 12 that are left over cannot be a last sheet either
    // (240px of rows against the 200px the totals leave), so they split again.
    const starts = billPageStarts(rows(40), M);
    expect(starts).toEqual([0, 14, 28, 39]);
    expect(pageSlices(starts, 40).slice(0, 2).every(({ start, end }) => end - start === 14)).toBe(true);
  });

  it("never leaves the last sheet holding more than the totals leave room for", () => {
    // The trap: a sheet filled to 280px of rows that then turns out to be the
    // last one owes 100px to the totals it has already given away.
    for (let n = 1; n <= 60; n++) {
      const r = rows(n);
      const starts = billPageStarts(r, M);
      expect(tallest(starts, r, M)).toBeLessThanOrEqual(M.paper);
    }
  });

  it("puts every line on exactly one sheet, whatever the bill", () => {
    for (let n = 0; n <= 60; n++) {
      expect(tiles(billPageStarts(rows(n), M), n)).toBe(true);
    }
  });

  it("packs rows of mixed height - a wrapped medicine name is taller", () => {
    // 200 + 20 + rows <= 500 on a continuing sheet: 280px of rows.
    const r = [60, 60, 60, 60, 60, 20, 20];      // 340px, so it cannot be one sheet
    const starts = billPageStarts(r, M);
    expect(tiles(starts, r.length)).toBe(true);
    expect(tallest(starts, r, M)).toBeLessThanOrEqual(M.paper);
    expect(starts).toEqual([0, 4]);              // four 60s = 240px, then the rest
  });

  it("prints a line taller than a whole sheet rather than looping on it", () => {
    // Moving it would overflow the next sheet identically. It goes where it is,
    // and the sheets after it still pack normally.
    const r = [900, 20, 20];
    const starts = billPageStarts(r, M);
    expect(starts).toEqual([0, 1]);
    expect(tiles(starts, 3)).toBe(true);
  });

  it("gives every sheet at least one line - no blank sheet at the end", () => {
    for (let n = 1; n <= 60; n++) {
      const starts = billPageStarts(rows(n), M);
      expect(pageSlices(starts, n).every(({ start, end }) => end > start)).toBe(true);
    }
  });

  it("falls back to one sheet when the measurement is degenerate", () => {
    // A sheet not laid out yet, or a NaN out of getComputedStyle. One sheet is
    // what the bill did before it paginated; a sheet per line is not.
    expect(billPageStarts(rows(40), { ...M, paper: 0 })).toEqual([0]);
    expect(billPageStarts(rows(40), { ...M, paper: NaN })).toEqual([0]);
    expect(billPageStarts(rows(40), { ...M, overhead: 600 })).toEqual([0]);
  });
});
