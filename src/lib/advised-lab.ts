/**
 * WHAT BECAME OF A TEST THE DOCTOR ADVISED.
 *
 * The vocabulary lives here, not inside the service, for the same reason
 * admission-outcome.ts exists: the rule "was this actually ordered" is asked by
 * the reception screen, the printed OPD sheet, the discharge summary and the
 * outstanding list, and four copies of it would drift apart. It is also the only
 * way to test the rule without standing up a database.
 *
 * The gap this closes: advised tests used to be newline text on the OPD sheet.
 * Nothing turned them into orders and nothing could answer "which of these was
 * never done", so a test the doctor asked for and nobody re-typed silently did
 * not happen - and the doctor went on waiting for a result.
 */

export const ADVISED_STATUSES = ["OUTSTANDING", "ORDERED", "DECLINED"] as const;
export type AdvisedStatus = (typeof ADVISED_STATUSES)[number];

/** What each state means to the person reading the screen. */
export const ADVISED_LABEL: Record<AdvisedStatus, string> = {
  OUTSTANDING: "Not ordered",
  ORDERED: "Ordered",
  DECLINED: "Not needed",
};

/**
 * Derive the state of one advised line.
 *
 * ORDERED WINS OVER DECLINED, always. If both marks are somehow present - the
 * desk marked it not-needed and someone ordered it anyway, or two people acted
 * at once - the truth is that a sample was taken and a bill exists. Reporting
 * that as "not needed" would hide a real test from the record, which is the
 * worse of the two mistakes by a wide margin.
 */
export function advisedStatus(row: { labTestId: string | null; declinedAt: Date | string | null }): AdvisedStatus {
  if (row.labTestId) return "ORDERED";
  if (row.declinedAt) return "DECLINED";
  return "OUTSTANDING";
}

/** Is this line still waiting on somebody? The outstanding list is exactly these. */
export function isOutstanding(row: { labTestId: string | null; declinedAt: Date | string | null }): boolean {
  return advisedStatus(row) === "OUTSTANDING";
}

export interface MergedAdvice {
  name: string;
  ordered: boolean;
  declined: boolean;
}

/**
 * Collapse advice repeated across a stay into one line per test.
 *
 * A patient in for six days is advised "CBC" on three separate sheets and it is
 * drawn once. The discharge summary must show CBC once, as ORDERED - not three
 * times with two of them reading "not ordered", which would send a reader
 * hunting for tests that were never actually outstanding.
 *
 * Case-insensitive on the name, because the same test typed by two people on
 * two days is not two tests. The FIRST spelling seen is kept: it is what the
 * doctor wrote first, and picking arbitrarily between "CBC" and "cbc" at least
 * does so predictably.
 */
export function mergeAdvice(
  rows: { testName: string; labTestId: string | null; declinedAt: Date | string | null }[]
): MergedAdvice[] {
  const out = new Map<string, MergedAdvice>();
  for (const r of rows) {
    const name = r.testName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const prev = out.get(key);
    const status = advisedStatus(r);
    out.set(key, {
      name: prev?.name ?? name,
      ordered: (prev?.ordered ?? false) || status === "ORDERED",
      declined: (prev?.declined ?? false) || status === "DECLINED",
    });
  }
  return [...out.values()];
}

/**
 * De-duplicate what the desk typed into the "advised" box on one sheet.
 *
 * "CBC" written twice on a single sheet is a transcription slip, not two orders
 * to chase - and it would otherwise appear twice on the outstanding list, where
 * clearing one would leave a phantom behind.
 */
export function dedupeAdvisedNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
