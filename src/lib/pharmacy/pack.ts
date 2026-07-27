/**
 * PACKS versus UNITS - the one distinction the pharmacy runs on.
 *
 * A distributor sells PACKS. A patient buys UNITS.
 *
 *   Invoice:   PARACETAMOL 500MG · PACK 15T · QTY 3      -> 3 strips
 *   Counter:   "give me 5 tablets"                       -> 5 tablets
 *   Reality:   3 strips x 15 tablets = 45 tablets on the shelf
 *
 * Storing a bare `quantity` with no unit conflates the two, and every downstream
 * number then lies:
 *
 *   - stock reads 3 when 45 tablets are physically on the shelf;
 *   - dispensing 5 tablets is refused because "only 3 available";
 *   - MRP is printed PER PACK (Rs 18.59 a strip), so billing it per tablet
 *     charges a patient Rs 92.95 for five paracetamol instead of Rs 6.20.
 *
 * THE RULE, enforced everywhere below this file:
 *
 *   StockBatch.quantity is ALWAYS in dispensing units (tablets, ml, capsules).
 *   StockBatch.packSize says how many of those made up one purchased pack.
 *   StockBatch.mrp and .purchasePrice stay PER PACK, exactly as printed on the
 *   strip and on the invoice - dividing by packSize gives the per-unit price.
 *
 * Keeping money per-pack and stock per-unit is deliberate: the MRP printed on
 * the carton is a legal figure a patient can read, and rewriting it into a
 * per-tablet number would make the bill disagree with the box in their hand.
 */

/** What a pack label decomposes into. */
export interface PackSpec {
  /** Dispensing units in one pack. 15T -> 15, 200ML -> 200. Never below 1. */
  size: number;
  /** The dispensing unit: "tablet", "ml", "capsule", "unit". */
  unit: string;
  /** True when the label was understood. False -> size 1, treat as loose units. */
  known: boolean;
}

/**
 * Indian pharma pack suffixes.
 *
 * `S` is the awkward one: "10`S" / "10'S" / "10S" is trade shorthand for
 * "10's", i.e. ten of whatever the product is - it is NOT a unit of its own.
 * OCR also reads the apostrophe as a backtick, a comma, or drops it entirely.
 */
const SUFFIX_UNITS: { re: RegExp; unit: string }[] = [
  { re: /^(?:ML|M L)$/i, unit: "ml" },
  { re: /^(?:GM?|GRAM)$/i, unit: "gm" },
  { re: /^T(?:AB)?$/i, unit: "tablet" },
  { re: /^C(?:AP)?$/i, unit: "capsule" },
  { re: /^(?:R|RESP|RESPULE)$/i, unit: "respule" },
  { re: /^(?:V|VIAL)$/i, unit: "vial" },
  { re: /^(?:AMP)$/i, unit: "ampoule" },
  { re: /^(?:INJ)$/i, unit: "injection" },
  { re: /^(?:SUPP?)$/i, unit: "suppository" },
  { re: /^(?:['`’,]?S)$/i, unit: "unit" },       // 10'S / 15`S / 5S -> "10's"
];

/**
 * "15T" -> 15 tablets. "200ML" -> 200 ml. "10`S" -> 10 units.
 *
 * An unreadable label is NOT guessed at: it returns size 1 and known:false, so
 * the stock is treated as loose units and nothing is silently multiplied. A
 * wrong pack size is worse than no pack size - it would inflate the shelf by a
 * factor nobody notices until a count.
 */
export function parsePack(label: string | null | undefined): PackSpec {
  const raw = (label ?? "").trim();
  if (!raw) return { size: 1, unit: "unit", known: false };

  // Strip the noise OCR leaves around the join: "1225ML", "15 T", "10-S".
  const m = raw.replace(/\s+/g, "").match(/^(\d{1,4})\s*([A-Za-z'`’,]{0,6})$/);
  if (!m) return { size: 1, unit: "unit", known: false };

  const size = Number(m[1]);
  if (!Number.isFinite(size) || size < 1 || size > 5000) return { size: 1, unit: "unit", known: false };

  const suffix = m[2] ?? "";
  if (!suffix) {
    // A bare number is a count of somethings - "10" means ten of them.
    return { size, unit: "unit", known: true };
  }
  for (const { re, unit } of SUFFIX_UNITS) {
    if (re.test(suffix)) return { size, unit, known: true };
  }
  // A suffix we don't recognise. Take the size (it is unambiguous) but don't
  // invent a unit name.
  return { size, unit: "unit", known: true };
}

/** Packs -> dispensing units. The single conversion, used on every receipt. */
export const packsToUnits = (packs: number, packSize: number): number =>
  Math.round(packs * Math.max(1, packSize));

/**
 * Per-unit price from a per-pack price.
 *
 * Rounded to paise. A 15-tablet strip at Rs 18.59 is Rs 1.24 a tablet - the
 * third decimal is not money and carrying it only makes bills fail to reconcile.
 */
export const perUnitPrice = (packPrice: number, packSize: number): number =>
  Math.round((packPrice / Math.max(1, packSize)) * 100) / 100;

/**
 * "45 tablets (3 x 15T)" - what the shelf should actually say.
 *
 * Showing only "45" is how a pharmacist loses track of how many boxes to look
 * for; showing only "3" is the bug this whole file exists to fix.
 */
export function describeStock(units: number, packSize: number, unit: string, packLabel?: string | null): string {
  const u = `${units} ${unit}${units === 1 ? "" : "s"}`;
  if (packSize <= 1) return u;
  const whole = Math.floor(units / packSize);
  const loose = units % packSize;
  const parts = [];
  if (whole) parts.push(`${whole} x ${packLabel?.trim() || `${packSize}`}`);
  if (loose) parts.push(`${loose} loose`);
  return parts.length ? `${u} (${parts.join(" + ")})` : u;
}
