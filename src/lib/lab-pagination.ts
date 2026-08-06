/**
 * Packing a lab panel's analytes onto sheets.
 *
 * The measuring lives in the print component - row heights depend on how a name
 * wraps in its column, which only the browser knows. The ARITHMETIC lives here,
 * where it can be tested without a DOM, because the failure it guards against is
 * the worst one this report has: an analyte that belongs to page one and is
 * never printed on page two either, lost between two sheets that both look
 * complete.
 *
 * The model is a list of page STARTS. `[0]` is everything on one sheet; `[0, 14]`
 * is rows 0-13 on the first and 14 onwards on the second. Starts are strictly
 * increasing and always begin at 0, so the slices they describe tile the analyte
 * list exactly - no gaps, no repeats.
 */

/**
 * How many of a sheet's rows stay on it when the sheet stands `overBy` pixels
 * taller than the paper.
 *
 * Rows are shed from the BOTTOM until enough height has come off. At least one
 * always stays: a row taller than a whole page would overflow the next sheet
 * identically, so moving it just walks the problem down the document forever.
 * The caller reports that case rather than looping on it.
 */
export function rowsThatFit(rowHeights: number[], overBy: number): number {
  let keep = rowHeights.length;
  let shed = 0;
  while (keep > 1 && shed < overBy) {
    keep -= 1;
    shed += rowHeights[keep];
  }
  return keep;
}

/**
 * The page starts after sheet `k` gives up everything past its first `keep` rows.
 *
 * When a later sheet already exists its start moves EARLIER - the rows shed here
 * join the ones already on it. Only when `k` is the last sheet does a new one
 * open. Getting that wrong is how a repack inserts a page whose rows are already
 * printed on the next one.
 *
 * The same array comes back when nothing would change, so a caller can use
 * identity to tell that the packing has settled. That is also what stops two
 * sheets trading a row back and forth: a break never moves later, only earlier.
 */
export function repack(starts: number[], k: number, keep: number, rowCount: number): number[] {
  const start = starts[k];
  if (start == null) return starts;
  const nextStart = start + Math.max(1, keep);
  // Nothing left to move onto a sheet of its own.
  if (nextStart >= rowCount) return starts;

  const next = [...starts];
  if (k + 1 < next.length) {
    if (nextStart >= next[k + 1]) return starts;
    next[k + 1] = nextStart;
  } else {
    next.push(nextStart);
  }
  return next;
}

/**
 * The [start, end) slice of each sheet, given the page starts and how many rows
 * there are in total.
 *
 * Deliberately total: a start past the end of the list yields an empty sheet
 * rather than throwing, and the last sheet always runs to the end of the list
 * whatever the starts say. An analyte can be on the wrong page; it must never be
 * on no page.
 */
export function pageSlices(starts: number[], rowCount: number): { start: number; end: number }[] {
  if (!starts.length) return [{ start: 0, end: rowCount }];
  return starts.map((start, k) => ({
    start: Math.min(start, rowCount),
    end: k + 1 < starts.length ? Math.min(starts[k + 1], rowCount) : rowCount,
  }));
}
