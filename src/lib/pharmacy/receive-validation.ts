/**
 * WHAT IS MISSING ON A GOODS RECEIPT, FIELD BY FIELD.
 *
 * The receiving desk works off a paper invoice with twenty-odd lines on it,
 * often dropped in by OCR. Something is always missing from one of them, and
 * until this existed the screen said so in one aggregate sentence at the foot
 * of the modal - "3 lines need attention" - with no way to tell WHICH three,
 * or which box inside them.
 *
 * Worse, that sentence had two blind spots, and both of them degraded to a bare
 * "1 line needs attention." with no reason attached at all:
 *
 *   · a missing QUANTITY was never named - the breakdown had no branch for it
 *   · a line for a NEW product (one the catalogue has never seen) was skipped
 *     by the batch and expiry counts, because those only looked at lines that
 *     had already been matched to a catalogue medicine
 *
 * A technician staring at a greyed-out Post button and a sentence that names
 * nothing has no move left except to re-check twenty rows by eye. So the rule
 * lives here, once, as data: every problem carries the FIELD it belongs to, so
 * the grid can mark the exact box, and the summary underneath is generated from
 * the same list rather than written out a second time and left to drift.
 */

/** Every box on a receipt line that can be wrong. */
export type ReceiveField = "medicine" | "qty" | "free" | "batch" | "expiry";

/** The parts of a grid row this module judges. */
export interface ReceiveLine {
  /** Set once the line is matched to a catalogue product. */
  medicineId: string;
  /** True while the line is being keyed in as a brand-new product. */
  createNew?: boolean;
  /** The typed name, which is what a `createNew` line is identified by. */
  name: string;
  batchNo: string;
  /** ISO yyyy-mm-dd, straight off `<input type="date">`. */
  expiryDate: string;
  qty: string;
  freeQty: string;
}

export interface LineProblem {
  field: ReceiveField;
  /** Shown under the box itself - "Not selected", "Not filled". */
  message: string;
  /** How the same fault reads when counted up in the summary sentence. */
  summary: string;
  /**
   * True when the box is simply EMPTY, false when it holds something wrong.
   *
   * The grid waits for Post before marking empty boxes - a delivery is keyed in
   * top to bottom and lighting up every blank cell turns the screen red before
   * anyone has typed anything. A value that is present but unusable ("2.5"
   * packs) is answered the moment it is typed, because there is nothing to wait
   * for: the pharmacist is looking straight at it.
   */
  empty: boolean;
}

/**
 * Everything wrong with one line, in the order the columns are read.
 *
 * A pristine line - one nobody has touched - is still fully reported. The grid
 * decides WHEN to show these (it waits until Post is pressed); deciding that
 * here as well would give two places an opinion about the same thing.
 */
export function lineProblems(r: ReceiveLine): LineProblem[] {
  const problems: LineProblem[] = [];

  // A line is identified EITHER by a catalogue pick or by a typed new name, and
  // the message has to match which of the two boxes is actually on screen -
  // "Not selected" under a text input is nonsense.
  const named = r.createNew ? r.name.trim().length > 1 : !!r.medicineId;
  if (!named) {
    problems.push({
      field: "medicine",
      message: r.createNew ? "Not filled" : "Not selected",
      summary: "with no product",
      empty: true,
    });
  }

  const qty = String(r.qty ?? "").trim();
  if (!qty) {
    problems.push({ field: "qty", message: "Not filled", summary: "with no quantity", empty: true });
  } else if (!(Number(qty) > 0)) {
    problems.push({ field: "qty", message: "Must be more than 0", summary: "with a zero quantity", empty: false });
  } else if (!Number.isInteger(Number(qty))) {
    // Whole packs only: StockBatch.quantity is an integer column, so a
    // fractional qty is a 400 from the API with nothing on screen explaining
    // why. Liquids ARE invoiced as "2.5" - only the pharmacist knows whether
    // that is 2 bottles or 3, so it is surfaced rather than rounded.
    problems.push({ field: "qty", message: "Whole packs only", summary: "with a fractional quantity", empty: false });
  }

  // Free quantity is the one optional number here - blank means none.
  const free = String(r.freeQty ?? "").trim();
  if (free && !Number.isInteger(Number(free))) {
    problems.push({ field: "free", message: "Whole packs only", summary: "with a fractional free quantity", empty: false });
  }

  if (!r.batchNo.trim()) {
    problems.push({ field: "batch", message: "Not filled", summary: "with no batch number", empty: true });
  }
  if (!r.expiryDate) {
    problems.push({ field: "expiry", message: "Not selected", summary: "with no expiry date", empty: true });
  }

  return problems;
}

/** True when this line is ready to post. */
export const lineIsReady = (r: ReceiveLine): boolean => lineProblems(r).length === 0;

/**
 * The one sentence beside the Post button: why it will not go yet.
 *
 * Built from `lineProblems`, so it can never name a different set of faults
 * than the grid is marking. Null means the receipt is ready.
 */
export function receiptBlocker(supplierId: string, lines: ReceiveLine[]): string | null {
  if (!lines.length) return "Add at least one line.";
  if (!supplierId) return "Choose the supplier this delivery came from.";

  // Counted per line, in the order the summaries were produced - which is
  // column order, so the sentence and the grid scan the same way.
  const counts = new Map<string, number>();
  let bad = 0;
  for (const line of lines) {
    const problems = lineProblems(line);
    if (!problems.length) continue;
    bad++;
    for (const s of new Set(problems.map((p) => p.summary))) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  if (!bad) return null;

  const parts = [...counts].map(([summary, n]) => `${n} ${summary}`);
  return `${bad} line${bad === 1 ? "" : "s"} need${bad === 1 ? "s" : ""} attention - ${parts.join(", ")}.`;
}
