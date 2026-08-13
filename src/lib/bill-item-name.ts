/**
 * WHAT A BILL LINE IS CALLED ON THE PRINTED SHEET.
 *
 * The pharmacy writes everything it knows into one string:
 *
 *   "Dolo 650 · 10 tablets @ ₹2.50 (pack of 15 · MRP ₹37.50) · Batch AX2291"
 *
 * Every part of that is real and every part of it belongs somewhere - the batch
 * in the stock ledger, the MRP in the pricing, the pack size in the purchase
 * record. None of it belongs in the NAME column of a bill a patient reads. The
 * rate and the amount are already their own columns, so the line prints the
 * price twice and the patient reads a sentence to find out they were given
 * Dolo 650.
 *
 * So the name is cleaned HERE, at print time, and the stored description is left
 * exactly as it is. That matters: the description is what the audit trail, the
 * stock ledger and every existing bill already hold, and rewriting it to make a
 * sheet prettier would throw away the batch traceability that a drug recall
 * depends on. Cleaning at print gets the tidy bill AND keeps the record - and it
 * fixes bills that were raised months ago, which changing the writer never would.
 *
 * SURGICAL, NOT GENERAL. It strips the two patterns the pharmacy actually emits
 * and nothing else. A blanket "cut at the first ·" would turn
 * "Bed · Deluxe-04 · 3 days" into "Bed" and "Nursing care · 3 day(s) × ₹600"
 * into "Nursing care" - throwing away exactly the detail that makes a room
 * charge checkable.
 */

/**
 * The dispensing forms the pharmacy masters seed. Used only to decide whether a
 * TRAILING parenthetical is a unit worth dropping - "Dolo 650 (Tablet)" is a
 * tablet name with noise on the end, while "CBP (Complete Blood Picture)" is a
 * test whose parenthetical is the actual name. Matching a known list is what
 * keeps the second one intact.
 */
const UNIT_WORDS = new Set([
  "tablet", "tablets", "capsule", "capsules", "syrup", "suspension",
  "injection", "infusion", "ointment", "cream", "gel", "drops", "eye drops",
  "inhaler", "suppository", "sachet", "spray", "powder", "strip", "strips",
  "bottle", "bottles", "vial", "vials", "tube", "tubes", "ml", "unit", "units",
]);

/** " · Batch AX2291" — the batch tail, always last when present. */
const BATCH_TAIL = /\s*·\s*Batch\s+(\S+)\s*$/i;

/**
 * " · 10 tablets @ ₹2.50 (pack of 15 · MRP ₹37.50)" — the quantity-and-price
 * middle. Note the inner "·" inside the bracket, which is why this is matched as
 * one shape rather than split on the separator.
 */
const QTY_PRICE_SEGMENT = /\s*·\s*\d+(?:\.\d+)?\s+\S+\s*@\s*₹?[\d.,]+\s*(?:\([^)]*\))?/iu;

/** A trailing "(Tablet)" / "(ml)", dropped only for a known dispensing unit. */
const TRAILING_PAREN = /\s*\(([^)]{1,20})\)\s*$/;

/**
 * The name to print for a bill line.
 *
 * Returns the description unchanged when none of the pharmacy patterns are
 * present, so lab, consultation, bed, nursing and hand-typed lines are
 * untouched.
 */
export function billItemName(description: string): string {
  let s = (description ?? "").trim();
  if (!s) return s;

  s = s.replace(BATCH_TAIL, "");
  s = s.replace(QTY_PRICE_SEGMENT, "");

  const paren = s.match(TRAILING_PAREN);
  if (paren && UNIT_WORDS.has(paren[1].trim().toLowerCase())) {
    s = s.replace(TRAILING_PAREN, "");
  }

  // A description that was ONLY the stripped parts would leave nothing to print.
  // Better a noisy name than a blank line on a bill.
  return s.trim() || description.trim();
}

/**
 * THE BATCH NUMBER, PULLED OUT SO IT CAN HAVE ITS OWN COLUMN.
 *
 * Taking the batch out of the name was right; taking it off the bill was not.
 * A pharmacy invoice has to carry the batch of what was dispensed - it is what a
 * recall is worked backwards from, and what a patient returning a strip is
 * checked against. Its own column is where it belongs: legible, aligned down the
 * page, and not wedged into the middle of a drug name.
 *
 * Returns null for every line that is not a dispensed medicine, which is what
 * lets the column appear only on bills that actually have batches - a Batch
 * heading over a column of dashes on a consultation bill is worse than no
 * column at all.
 */
export function billItemBatch(description: string): string | null {
  const m = (description ?? "").trim().match(BATCH_TAIL);
  return m ? m[1] : null;
}
