/**
 * MASTER DATA, READ SAFELY DURING CHANGEOVER.
 *
 * Every descriptor on a medicine now exists twice: as a link to a master row,
 * and as the free-text column it used to be. That is not duplication for its own
 * sake - it is what lets a catalogue be linked up one row at a time, by whoever
 * knows the answer, instead of in a single migration that would have to guess
 * which of "Cipla", "CIPLA" and "Cipla Ltd" were the same company.
 *
 * THE RULE IS ALWAYS THE SAME: prefer the master, fall back to the string, and
 * be honest about which one you got. Written once, here, because a fallback
 * re-implemented at each call site is a fallback that disagrees with itself -
 * and the disagreement shows up as a medicine that reads "Cipla" on the stock
 * list and blank on the label.
 *
 * `source` is not decoration. The screens use it to show which rows are still
 * on free text, because "what is left to link" is the only question that makes
 * the changeover finishable.
 */

export const MASTER_KINDS = [
  "category",
  "generic",
  "manufacturer",
  "dosageForm",
  "unit",
  "tax",
  "hsn",
  "schedule",
] as const;

export type MasterKind = (typeof MASTER_KINDS)[number];

/** Where a displayed value actually came from. */
export type MasterSource = "master" | "legacy" | "none";

export interface Resolved {
  /** What to show. Null when neither side has anything. */
  value: string | null;
  source: MasterSource;
}

/**
 * Prefer the master's name; fall back to the legacy free-text column.
 *
 * Whitespace-only is treated as absent on both sides - a column containing " "
 * is not data, and letting it win over a real master row would be the worst of
 * both worlds.
 */
export function resolveMaster(
  masterName: string | null | undefined,
  legacy: string | null | undefined
): Resolved {
  const m = (masterName ?? "").trim();
  if (m) return { value: m, source: "master" };
  const l = (legacy ?? "").trim();
  if (l) return { value: l, source: "legacy" };
  return { value: null, source: "none" };
}

/** Convenience for the common case where only the text is wanted. */
export const masterValue = (
  masterName: string | null | undefined,
  legacy: string | null | undefined
): string | null => resolveMaster(masterName, legacy).value;

/**
 * THE EFFECTIVE GST RATE FOR A MEDICINE.
 *
 * `Medicine.gstRatePct` stays the authority, deliberately. The HSN's default is
 * a SEED for new products and a cross-check for existing ones - not an override.
 * Letting the HSN win here would silently reprice a product the moment somebody
 * corrected a master, and the first anyone would know of it is a wrong bill.
 *
 * So this returns the product's own rate, and separately reports whether it
 * disagrees with the classification it is filed under. A screen can then show
 * the disagreement and let a human decide, which is the only safe resolution.
 */
export function effectiveGstRate(input: {
  medicineRatePct: number;
  hsnDefaultRatePct?: number | null;
}): { ratePct: number; disagreesWithHsn: boolean; hsnRatePct: number | null } {
  const rate = Number(input.medicineRatePct);
  const hsn = input.hsnDefaultRatePct == null ? null : Number(input.hsnDefaultRatePct);
  return {
    ratePct: rate,
    hsnRatePct: hsn,
    disagreesWithHsn: hsn !== null && Math.abs(hsn - rate) > 0.001,
  };
}

/** How each master is labelled in the UI, and what its rows are called. */
export const MASTER_META: Record<
  MasterKind,
  { title: string; singular: string; blurb: string; labelField: "name" | "code" }
> = {
  category: {
    title: "Categories",
    singular: "Category",
    blurb: "Therapeutic or shelf grouping. Organisational only - never affects price or tax.",
    labelField: "name",
  },
  generic: {
    title: "Generics / salts",
    singular: "Generic",
    blurb: "What is actually in the product. This is what makes substitution possible when a shelf is empty.",
    labelField: "name",
  },
  manufacturer: {
    title: "Manufacturers",
    singular: "Manufacturer",
    blurb: "Who makes it - not who sells it to you. Distributors live under Suppliers.",
    labelField: "name",
  },
  dosageForm: {
    title: "Dosage forms",
    singular: "Dosage form",
    blurb: "Tablet, capsule, syrup, injection. The form, not the unit it is measured in.",
    labelField: "name",
  },
  unit: {
    title: "Units",
    singular: "Unit",
    blurb: "The dispensing unit - what one of these is when handed to a patient. Never the pack.",
    labelField: "name",
  },
  tax: {
    title: "Tax rates",
    singular: "Tax rate",
    blurb: "Named GST rates to pick from. Changing one never reprices anything already sold.",
    labelField: "name",
  },
  hsn: {
    title: "HSN codes",
    singular: "HSN code",
    blurb: "The government's classification, and what GST returns are filed against. Carries the rate it ordinarily attracts.",
    labelField: "code",
  },
  schedule: {
    title: "Drug schedules",
    singular: "Drug schedule",
    blurb:
      "Regulatory classification (H, H1, X). Enter these from your own licence documentation - nothing here is ever filled in automatically.",
    labelField: "code",
  },
};
