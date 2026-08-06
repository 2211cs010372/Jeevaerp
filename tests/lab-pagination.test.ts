import { describe, it, expect } from "vitest";
import { rowsThatFit, repack, pageSlices } from "@/lib/lab-pagination";

/**
 * The one thing a paginated lab report must never do is lose an analyte between
 * two sheets that both look complete. Most of these tests are that invariant
 * stated from a different angle.
 */

/** Every row lands on exactly one sheet, in order. */
function tiles(starts: number[], rowCount: number): boolean {
  const seen = pageSlices(starts, rowCount).flatMap(({ start, end }) =>
    Array.from({ length: Math.max(0, end - start) }, (_, i) => start + i));
  return seen.length === rowCount && seen.every((v, i) => v === i);
}

describe("rowsThatFit", () => {
  it("keeps every row when the sheet is not over", () => {
    expect(rowsThatFit([20, 20, 20], 0)).toBe(3);
  });

  it("sheds from the bottom until enough height has come off", () => {
    // over by 25px; dropping the last row frees 20, still short, so two go.
    expect(rowsThatFit([20, 20, 20, 20], 25)).toBe(2);
  });

  it("sheds exactly one row when one row's worth is enough", () => {
    expect(rowsThatFit([20, 20, 20, 20], 15)).toBe(3);
  });

  it("never sheds the last row - a row taller than a page cannot be helped", () => {
    expect(rowsThatFit([900], 400)).toBe(1);
    expect(rowsThatFit([20, 900], 800)).toBe(1);
  });
});

describe("repack", () => {
  it("opens a new sheet when the overflowing one is the last", () => {
    expect(repack([0], 0, 8, 12)).toEqual([0, 8]);
  });

  it("moves an existing later break earlier rather than inserting a page", () => {
    // sheet 0 held rows 0-13 and can only keep 10: sheet 1 now starts at 10,
    // and there are still two sheets, not three.
    expect(repack([0, 14], 0, 10, 20)).toEqual([0, 10]);
  });

  it("refuses to move a break later, so two sheets cannot trade a row forever", () => {
    const starts = [0, 10];
    expect(repack(starts, 0, 12, 20)).toBe(starts);
  });

  it("returns the same array when there is nothing left to move", () => {
    const starts = [0];
    expect(repack(starts, 0, 5, 5)).toBe(starts);
  });

  it("always moves at least one row, even when told to keep none", () => {
    expect(repack([0], 0, 0, 6)).toEqual([0, 1]);
  });

  it("keeps the starts strictly increasing", () => {
    const out = repack([0, 5, 9], 1, 2, 14);
    expect(out).toEqual([0, 5, 7]);
    expect(out.every((v, i) => i === 0 || v > out[i - 1])).toBe(true);
  });
});

describe("pageSlices", () => {
  it("puts everything on one sheet by default", () => {
    expect(pageSlices([0], 5)).toEqual([{ start: 0, end: 5 }]);
  });

  it("tiles the analyte list with no gaps and no repeats", () => {
    expect(tiles([0], 9)).toBe(true);
    expect(tiles([0, 4], 9)).toBe(true);
    expect(tiles([0, 4, 7], 9)).toBe(true);
  });

  it("runs the last sheet to the end of the list whatever the starts say", () => {
    expect(pageSlices([0, 3], 10).at(-1)).toEqual({ start: 3, end: 10 });
  });

  it("clamps a start past the end instead of throwing", () => {
    const out = pageSlices([0, 8], 5);
    expect(out).toEqual([{ start: 0, end: 5 }, { start: 5, end: 5 }]);
    expect(tiles([0, 8], 5)).toBe(true);
  });

  it("survives an empty panel", () => {
    expect(pageSlices([0], 0)).toEqual([{ start: 0, end: 0 }]);
  });
});

describe("the packing loop as a whole", () => {
  /**
   * The component's loop: render, measure, repack, repeat. Simulated here with
   * fixed row heights so the arithmetic can be checked end to end - what it must
   * produce is a packing that settles, that fits, and that prints every row once.
   */
  function pack(heights: number[], capacity: number): number[] {
    let starts = [0];
    for (let guard = 0; guard < 100; guard++) {
      const slices = pageSlices(starts, heights.length);
      let changed = false;
      for (let k = 0; k < slices.length; k++) {
        const { start, end } = slices[k];
        const rows = heights.slice(start, end);
        const used = rows.reduce((a, b) => a + b, 0);
        if (used <= capacity) continue;
        const next = repack(starts, k, rowsThatFit(rows, used - capacity), heights.length);
        if (next !== starts) { starts = next; changed = true; }
        break;
      }
      if (!changed) return starts;
    }
    throw new Error("packing did not settle");
  }

  it("settles, fits and prints every row exactly once", () => {
    const heights = Array.from({ length: 37 }, (_, i) => 18 + (i % 5) * 4);
    const capacity = 200;
    const starts = pack(heights, capacity);

    expect(tiles(starts, heights.length)).toBe(true);
    for (const { start, end } of pageSlices(starts, heights.length)) {
      const used = heights.slice(start, end).reduce((a, b) => a + b, 0);
      // Every sheet fits, or holds a single row that cannot be split.
      expect(used <= capacity || end - start === 1).toBe(true);
    }
  });

  it("leaves a panel that already fits on one sheet", () => {
    expect(pack([20, 20, 20], 200)).toEqual([0]);
  });

  it("settles even when one row is taller than a whole page", () => {
    const starts = pack([20, 500, 20], 200);
    expect(tiles(starts, 3)).toBe(true);
  });
});
