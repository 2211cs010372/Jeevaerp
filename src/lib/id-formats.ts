/**
 * Human-facing ID formats. One house style: JMH, the year, a document marker,
 * then a short serial that restarts every January.
 *
 *   PATIENT   -> JMH2026OP00123    (UHID; on the OP slip, and what the patient logs in with)
 *   IP        -> JMH2026IP00007    (per admission; on the case sheet and the wristband)
 *   INVOICE   -> JMH20260312       (every invoice, any source - ONE sequence)
 *   OP        -> JMH2026AP0045     (per appointment)
 *   CLAIM     -> JMH2026CLM0045    (insurance claim)
 *   ADV       -> JMH2026ADV0012    (IPD advance / deposit acknowledgement)
 *
 * Three rules hold this together:
 *
 * 1. NO HYPHENS on anything a patient reads back or a scanner reads off paper.
 *    "INV-2026-000312" spoken down a phone line is four things to get wrong;
 *    JMH20260312 is one. The CODE128 barcode on the bill is shorter for it too,
 *    which is the difference between one pass and three at a counter scanner.
 *
 * 2. The marker after the year is unique per document kind, because all of these
 *    land in the same search boxes. `OP` is spoken for by the UHID permanently -
 *    that is why an appointment is AP and not OP, since `JMH2026OP00045` would
 *    be a patient, not a visit. The invoice series carries no marker at all:
 *    bare digits can never be read as another kind.
 *
 * 3. Serials are 4 wide for documents, 5 for the two identities a patient keeps
 *    for life (UHID, IP). `padStart` is a floor and not a ceiling, so the
 *    10,000th invoice of a year is JMH202610000 - one digit wider, still unique.
 *
 * GST: a tax invoice number may be at most 16 characters, alphanumeric plus `/`
 * and `-`, and may not begin with 0 (see `isValidDocNo` in
 * lib/gst/einvoice-payload.ts). JMH20260312 is 11, leaving headroom.
 *
 * Numbers issued before this scheme (INV-2026-000312, OP-2026-000045) are left
 * exactly as they were printed and filed. The counters keep counting, so the two
 * shapes coexist without a renumbering and without a gap in the series.
 *
 * This module is pure on purpose - no database, no clock - so the rules above
 * are covered by tests/ids.test.ts. `nextId` in ./ids.ts is what callers use.
 */

/** Documents: one per transaction, thousands a year. */
const doc = (n: number) => String(n).padStart(4, "0");
/** Identities a patient keeps for life - wider, and never re-cut. */
const identity = (n: number) => String(n).padStart(5, "0");
/** Distributor-facing paperwork, deliberately left on the old shape. */
const pad = (n: number) => String(n).padStart(6, "0");

export const FORMATS = {
  PATIENT: (y: number, n: number) => `JMH${y}OP${identity(n)}`,
  /** Inpatient admission - printed on the case sheet and wristband. */
  IP: (y: number, n: number) => `JMH${y}IP${identity(n)}`,
  /// Every invoice from every counter - consultation, pharmacy, lab, IPD
  /// discharge - draws from this one sequence. One series per year is what the
  /// GST return expects, and it means no counter can issue a number that
  /// another counter has already handed out.
  INVOICE: (y: number, n: number) => `JMH${y}${doc(n)}`,
  /// Appointment. AP, not OP: see rule 2 above.
  OP: (y: number, n: number) => `JMH${y}AP${doc(n)}`,
  /// Insurance claim.
  CLAIM: (y: number, n: number) => `JMH${y}CLM${doc(n)}`,
  /// IPD advance / deposit acknowledgement. Deliberately its own series, NOT
  /// the INVOICE one: a deposit is money held, not a supply, so it must never
  /// occupy a tax-invoice number.
  ADV: (y: number, n: number) => `JMH${y}ADV${doc(n)}`,
  /// Website callback request - REQ-2026-000012. Quoted back to the patient by
  /// SMS so they have something to say on the phone. Not an OP number: no visit
  /// exists yet, and issuing one here would burn the OP series on enquiries.
  REQ: (y: number, n: number) => `REQ-${y}-${pad(n)}`,
  /// Pharmacy purchase order - PO-2026-000012. Printed and sent to the distributor.
  PO: (y: number, n: number) => `PO-${y}-${pad(n)}`,
  /// Goods receipt note - GRN-2026-000034. The document a batch traces back to.
  GRN: (y: number, n: number) => `GRN-${y}-${pad(n)}`,
  /// Purchase return / debit note to a distributor - PR-2026-000008.
  PRETURN: (y: number, n: number) => `PR-${y}-${pad(n)}`,
} as const;

export type IdKind = keyof typeof FORMATS;

/** The kinds a patient or a scanner sees, and which therefore follow the rules above. */
export const PATIENT_FACING_KINDS = ["PATIENT", "IP", "INVOICE", "OP", "CLAIM", "ADV"] as const;

/**
 * The pure half of `nextId`: kind + year + counter value -> printed number.
 * Separated from the counter so the formats can be tested without a database,
 * which is the only way the collision rules stay true as kinds get added.
 */
export function formatId(kind: IdKind, year: number, n: number): string {
  return FORMATS[kind](year, n);
}
