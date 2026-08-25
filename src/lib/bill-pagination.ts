/**
 * Packing a bill's item lines onto half-sheets.
 *
 * The measuring lives in the print component - a row's height depends on how a
 * medicine's name wraps in its column, which only the browser knows. The
 * ARITHMETIC lives here, where it can be tested without a DOM, because the
 * failure it guards against is the worst one a bill has: a line that belongs to
 * sheet one and is never printed on sheet two either, lost between two
 * half-sheets that both look complete and a Net Payable that still counts it.
 *
 * The model is a list of page STARTS. `[0]` is everything on one sheet; `[0, 12]`
 * is items 0-11 on the first and 12 onwards on the second. Starts are strictly
 * increasing and always begin at 0, so the slices they describe tile the item
 * list exactly - no gaps, no repeats.
 *
 * WHY THIS ISN'T THE LAB REPORT'S PACKING. That one sheds rows off a sheet that
 * has overflowed and re-measures, which works because every one of its sheets is
 * the same shape. A bill's are not: the sheet that ENDS the bill carries the
 * totals, the amount in words, the signature line and the footer note, and the
 * ones before it carry a single carried-forward line. Shed-and-remeasure starts
 * by assuming sheet one is the last, sheds rows to make room for a totals block
 * that then moves off it, and cannot take them back - a break there only ever
 * moves earlier. On a thirty-four line pharmacy bill that came out as seven
 * half-sheets holding five lines each, a quarter of every sheet white. Here the
 * two capacities are known before anything is placed, so each sheet is filled
 * once, to the right one.
 */

export interface SheetMetrics {
  /** Usable height of one sheet, in px. */
  paper: number;
  /**
   * Everything on every sheet above the first item row - masthead, patient
   * block, section title, table header, the gaps between them - plus the
   * sheet's own bottom padding.
   */
  overhead: number;
  /** The foot of a sheet that ENDS the bill: totals, settlement, signature. */
  endFoot: number;
  /** The foot of a sheet that continues: the carried-forward strip. */
  contFoot: number;
}

/**
 * Where each sheet of the bill starts, given every item row's height.
 *
 * Fills from the top, one sheet at a time, and at each sheet asks the only
 * question that decides its shape: does everything still unprinted fit here
 * alongside the totals? If it does, this sheet ends the bill and takes the rest.
 * If it doesn't, this sheet continues, so it may fill to the roomier
 * continuation capacity instead - and must leave at least one line over, or it
 * would turn out to be the last sheet after all, owing room to the totals it
 * just filled with medicines.
 */
export function billPageStarts(rowHeights: number[], m: SheetMetrics): number[] {
  const starts = [0];
  const n = rowHeights.length;

  const contCap = m.paper - m.overhead - m.contFoot;
  const endCap = m.paper - m.overhead - m.endFoot;
  // A degenerate measurement - a sheet not laid out yet, a paper height of zero,
  // a NaN out of getComputedStyle - must not turn into a sheet per line. Print
  // it as one sheet, which is exactly what the bill did before it paginated.
  if (!(contCap > 0) || !(endCap > 0)) return starts;

  let i = 0;
  while (i < n) {
    let rest = 0;
    for (let j = i; j < n; j++) rest += rowHeights[j];
    // This sheet ends the bill. Nothing left to break.
    if (rest <= endCap) break;

    // `i + take < n - 1` is what keeps the last line back. Filling this sheet to
    // the continuation capacity and consuming everything would leave it as the
    // final sheet, carrying the totals in space it had already given away.
    let take = 0;
    let h = 0;
    while (i + take < n - 1 && h + rowHeights[i + take] <= contCap) {
      h += rowHeights[i + take];
      take += 1;
    }
    // A single line taller than a whole sheet cannot be helped by moving it - it
    // would overflow the next sheet identically. Print it where it is.
    if (take === 0) take = 1;

    i += take;
    if (i < n) starts.push(i);
  }

  return starts;
}
