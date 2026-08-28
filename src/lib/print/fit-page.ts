/**
 * ── THE PAPER, AND WHAT IS LEFT OF IT FOR THE DOCUMENT ──
 *
 * One definition, used three times: the screen sheet's padding, the printed
 * @page margin, and the height the fit-to-page measurement is allowed to fill.
 * They were three separate literals and two of them disagreed - the screen sat
 * on 10/11/12mm while the page printed 13/12/14mm - which is harmless until
 * something starts measuring one to predict the other.
 */
const A4_H_MM = 297;
export const PAPER = {
  /** Blank A4 out of the desk's own tray. */
  plain: { margin: "13mm 12mm 14mm", top: 13, bottom: 14 },
  /** The hospital's pre-printed paper: the bands reserve the printed ink. */
  stationery: { margin: "40mm 13mm 46mm", top: 40, bottom: 46 },
} as const;

/** CSS px per mm at the 96dpi the browser lays out in. */
const MM = 96 / 25.4;

/** How tall one printed page is, in px, once the margins are taken off. */
export const pageHeightPx = (onStationery: boolean) => {
  const p = onStationery ? PAPER.stationery : PAPER.plain;
  return (A4_H_MM - p.top - p.bottom) * MM;
};

/**
 * ── FIT THE SUMMARY TO A WHOLE NUMBER OF PAGES ──
 *
 * The complaint this exists for: a summary that ran a centimetre past the
 * bottom of page one put ONLY the two signatures and the footer line on page
 * two. `.ds-sign` carries `break-inside: avoid` - correctly, a signature split
 * down the middle is worse - so the whole block moves rather than splitting,
 * and a sheet of paper is spent on two ruled lines.
 *
 * So the document is squeezed to the nearest whole page instead. The zoom that
 * makes the content exactly fill `n` pages is
 *
 *     scale(n) = n·P / (H + (n-1)·T)
 *
 * where P is the printable page height, H the document's natural height and T
 * the repeated table header, which every page after the first pays for again.
 *
 * `n` is the page count it naturally takes; if it can be pulled back to n-1
 * without going below MIN_FIT, it is. Nothing is ever enlarged - a short
 * summary is a short summary, not one stretched to fill a sheet.
 *
 * MIN_FIT IS A LEGIBILITY FLOOR, not a preference. At 0.84 the 11.5px body
 * prints at about 9.7px, which is the smallest this document may be set at and
 * still be read by whoever it is handed to. A summary that would need more of a
 * squeeze than that keeps its extra page: a second sheet is a nuisance, and an
 * unreadable discharge summary is a medico-legal problem.
 */
const MIN_FIT = 0.84;

export function fitScale(
  /** Natural height of the document, unscaled. */
  contentPx: number,
  /** The repeated table header, which page two onwards carries again. */
  headerPx: number,
  /** Printable height of one page. */
  pagePx: number,
): number {
  if (!(contentPx > 0) || !(pagePx > 0)) return 1;

  /** The zoom at which the document exactly fills `n` pages. */
  const at = (n: number) => (n * pagePx) / (contentPx + (n - 1) * headerPx);

  // How many pages it takes as written. Capped so a pathological measurement
  // cannot spin: past ~40 pages nothing here is going to help anyway.
  let natural = 1;
  while (at(natural) < 1 && natural < 40) natural += 1;

  if (natural <= 1) return 1;

  const squeezed = at(natural - 1);
  return squeezed >= MIN_FIT ? Math.min(1, squeezed) : 1;
}
