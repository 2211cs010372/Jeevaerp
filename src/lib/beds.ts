/**
 * ONE definition of how a bed reads to a human.
 *
 * THE PROBLEM THIS SOLVES: `Bed.bedNo` is stored with its ward baked into it -
 * "ICU-02", "GW-10", "SP-03" - and almost every screen rendered it next to the
 * ward name as `${ward} · ${bedNo}`. For the ICU that came out as
 *
 *     ICU · ICU-02
 *
 * which says "ICU" twice and reads like a database row rather than a place a
 * person is lying. Printed bills, the discharge summary and the admission SMS
 * all carried it.
 *
 * The prefix is NOT removed from the stored value. `bedNo` is half of the
 * `@@unique([wardId, bedNo])` key and appears in years of historical admissions
 * and invoice line descriptions; rewriting it to make a label prettier would
 * mean a migration touching closed medico-legal records. So the data stays as
 * it is and the display is derived here, in one place, from ward + bedNo.
 */

/**
 * The bare number a bed is known by on the ward. "ICU-02" -> "2".
 *
 * Leading zeros go: "ICU-02" is a sort key, "bed 2" is what the nurse says.
 *
 * Returns the input untouched when there is no number to find. A hospital that
 * later names a bed "ISOLATION" gets "ISOLATION" back rather than an empty
 * string - a label that silently loses the bed is worse than an ugly one.
 */
export function bedNumber(bedNo: string | null | undefined): string {
  const raw = String(bedNo ?? "").trim();
  if (!raw) return "";
  // Trailing digits only: the prefix is the ward, the number is the bed. Anchored
  // at the end so "ICU-02" gives 02 and never picks up a digit from the prefix.
  const m = /(\d+)\s*$/.exec(raw);
  if (!m) return raw;
  const n = Number(m[1]);
  return Number.isFinite(n) ? String(n) : m[1];
}

/**
 * How a bed reads on its own, inside a screen already grouped by ward.
 * "ICU-02" -> "BED 2".
 */
export function bedShort(bedNo: string | null | undefined): string {
  const n = bedNumber(bedNo);
  return n ? `BED ${n}` : "";
}

/**
 * The full, unambiguous label. ("ICU", "ICU-02") -> "ICU BED 2".
 *
 * This is what belongs on anything that leaves the building - a bill, a
 * discharge summary, an SMS - where the reader has no ward heading above it to
 * give the number its context.
 */
export function bedLabel(wardName: string | null | undefined, bedNo: string | null | undefined): string {
  const ward = String(wardName ?? "").trim();
  const short = bedShort(bedNo);
  if (!ward) return short;
  if (!short) return ward;
  return `${ward} ${short}`;
}
