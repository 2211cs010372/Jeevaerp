import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";

/**
 * Human-facing ID formats, all year-scoped:
 *   PATIENT   -> JMH2026OP00123    (printed on OP slip; patient logs in with this)
 *   OP        -> OP-2026-000045    (per appointment)
 *   INVOICE   -> INV-2026-000312   (every invoice, any source - one sequence)
 *   IP        -> JMH2026IP00007    (per inpatient admission)
 */
const pad = (n: number) => String(n).padStart(6, "0");

const FORMATS = {
  PATIENT: (y: number, n: number) => `JMH${y}OP${String(n).padStart(5, "0")}`,
  OP: (y: number, n: number) => `OP-${y}-${pad(n)}`,
  INVOICE: (y: number, n: number) => `INV-${y}-${pad(n)}`,
  /** Inpatient admission - printed on the case sheet and wristband. */
  IP: (y: number, n: number) => `JMH${y}IP${String(n).padStart(5, "0")}`,
  /** Insurance claim - CLM-2026-000045. */
  CLAIM: (y: number, n: number) => `CLM-${y}-${pad(n)}`,
  /// IPD advance / deposit acknowledgement - ADV-2026-000012. Deliberately its
  /// own series, NOT the INVOICE one: a deposit is money held, not a supply, so
  /// it must never occupy a tax-invoice number.
  ADV: (y: number, n: number) => `ADV-${y}-${pad(n)}`,
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

/**
 * Race-safe sequential ID generation.
 *
 * The insert-or-increment happens in ONE SQL statement, so two receptionists
 * registering patients in the same millisecond can never receive the same
 * number - Postgres serializes the row update internally.
 *
 * Pass `tx` to enrol the counter bump in a surrounding transaction (so an ID
 * is never burned if the operation that needed it rolls back).
 */
export async function nextId(
  kind: IdKind,
  opts: { year?: number; tx?: Prisma.TransactionClient } = {}
): Promise<string> {
  const year = opts.year ?? new Date().getFullYear();
  const db = opts.tx ?? prisma;
  const key = `${kind}-${year}`;
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value")
    VALUES (${key}, 1)
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  return FORMATS[kind](year, rows[0].value);
}
