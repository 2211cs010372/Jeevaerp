/**
 * THE SAME BILL, GENERATED TWICE.
 *
 * The owner's rule (29 Sep 2026): a lab test can be done again and a medicine
 * dispensed again whenever there is a need - a repeat is a clinical decision
 * and is never blocked. What must not happen is ONE billing action producing
 * TWO bills. On the live data that had happened 30 times: 26 lab and 4
 * pharmacy bills with the same patient, the same lines and the same total, by
 * the same person, from half a minute to eight minutes after the first - the
 * desk thought the first had failed and pressed again - and in 25 of them both
 * copies carried a payment.
 *
 * So the check is narrow on purpose: the same items for the same patient
 * within REPEAT_WINDOW_MIN. A real repeat - hours later, or a different set -
 * never sees it. Inside the window the server refuses with a 409 whose
 * `details` is a RepeatBlock, and every screen shows it in the same
 * RepeatConfirmDialog, whose first answer is "print the bill already made".
 * Going ahead anyway is a deliberate second click (`confirmRepeat`).
 *
 * Shared by server and browser, so nothing in here may touch Prisma.
 */

export type RepeatKind = "LAB_TEST" | "DISPENSE" | "STAY_CHARGE" | "CONSULTATION";

/** One earlier entry the new one repeats. */
export interface RepeatItem {
  /** "C-Reactive Protein (CRP)", "Pan 40, Dolo 650", "Dressing". */
  label: string;
  /** When the earlier one was entered (ISO). */
  at: string;
  /** Its state as the desk needs it: "Pending · on bill JMH20261072". */
  detail: string | null;
  /** The live bill it is already on, so the desk can print that one instead. */
  invoiceId?: string | null;
}

export interface RepeatBlock {
  code: "REPEAT_ENTRY";
  kind: RepeatKind;
  items: RepeatItem[];
}

/**
 * How recent an identical entry has to be to count as the same one entered
 * twice. The regenerated bills found were 0.5-8.3 minutes apart; a repeat a
 * doctor actually asks for is hours apart.
 */
export const REPEAT_WINDOW_MIN = 10;

/** Start of the window, for a `createdAt: { gte }` filter. */
export const repeatWindowStart = (now = Date.now()) => new Date(now - REPEAT_WINDOW_MIN * 60_000);

/** "3 minutes ago", for the server's refusal sentence. */
export const minutesAgo = (at: Date, now = Date.now()) => {
  const m = Math.max(1, Math.round((now - at.getTime()) / 60_000));
  return `${m} minute${m === 1 ? "" : "s"} ago`;
};

/** The RepeatBlock inside a failed request, or null for any other failure. */
export function repeatBlock(err: unknown): RepeatBlock | null {
  const e = err as { status?: number; details?: { code?: string } } | null;
  if (e?.status !== 409 || e.details?.code !== "REPEAT_ENTRY") return null;
  return e.details as RepeatBlock;
}
