/**
 * INVOICE MATH - deliberately pure.
 *
 * This used to live inside `createInvoice`'s Prisma `$transaction`. That meant you
 * could not check whether a bill added up without standing up a Postgres database,
 * which is a very good way to end up with a hospital billing system that has no
 * tests at all.
 *
 * Nothing in here touches the database, the clock, or the network. Given the same
 * lines it returns the same numbers, every time, in about a microsecond - so it can
 * be tested to death.
 *
 * The arithmetic is unchanged from the original. Do not "tidy" it: the rounding
 * order is load-bearing (see roundingIsPerLine below).
 *
 * ONE ADDITION (29 Sep 2026): the TOTAL is a whole number of rupees - see
 * lib/money-round. Tax is still computed to the paisa on the taxable value; the
 * difference is `roundOff`, printed as its own line.
 */

import { roundBill, SETTLED_BELOW } from "@/lib/money-round";

export interface CalcLine {
  description: string;
  qty?: number;
  unitPrice: number;
  /** 0 for exempt (consultation, diagnostics, most room rent). */
  gstRatePct?: number;
}

/** Whatever extra fields the caller's line carried (batchId, labTestId, hsnSac…)
 *  travel through untouched - the calc only ADDS qty/gstRatePct/amount. */
export type CalcItem<L extends CalcLine = CalcLine> = L & {
  qty: number;
  gstRatePct: number;
  /** qty × unitPrice, before any discount. */
  amount: number;
};

export interface InvoiceTotals<L extends CalcLine = CalcLine> {
  items: CalcItem<L>[];
  subtotal: number;
  discount: number;
  /** subtotal − discount. The base GST is charged on. */
  taxable: number;
  cgst: number;
  sgst: number;
  /** Whole rupees: taxable + cgst + sgst + roundOff. */
  total: number;
  /** What rounding the total to the rupee added (+) or took off (-). Within ±0.50. */
  roundOff: number;
}

/** Money is rounded to paise at every step - never carried as a float tail. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

export class InvoiceMathError extends Error {}

/**
 * Discount is spread across lines *proportionally, before tax* - not slapped on
 * the end. This matters: a bill with an exempt consultation and a taxable medicine
 * must not have the whole discount silently eaten by the taxable line, because that
 * would change the GST owed to the government.
 *
 * CGST and SGST are each half the line tax (intra-state, Telangana 36). Inter-state
 * IGST is NOT handled - Jeeva bills locally. If that ever changes, this is the one
 * function to touch.
 */
export function computeInvoiceTotals<L extends CalcLine>(
  lines: L[],
  discountAmount = 0
): InvoiceTotals<L> {
  if (!lines.length) throw new InvoiceMathError("Add at least one item to the bill");

  let subtotal = 0;
  const items: CalcItem<L>[] = lines.map((l) => {
    const qty = l.qty && l.qty > 0 ? l.qty : 1;
    const amount = r2(qty * l.unitPrice);
    subtotal = r2(subtotal + amount);
    return { ...l, qty, gstRatePct: l.gstRatePct ?? 0, amount };
  });

  const discount = r2(discountAmount ?? 0);
  if (discount > subtotal) throw new InvoiceMathError("Discount can't exceed the bill amount");

  const discountRatio = subtotal > 0 ? discount / subtotal : 0;

  let taxable = 0;
  let cgst = 0;
  let sgst = 0;
  for (const it of items) {
    const lineAfterDiscount = r2(it.amount * (1 - discountRatio));
    taxable = r2(taxable + lineAfterDiscount);
    const lineTax = r2((lineAfterDiscount * it.gstRatePct) / 100);
    cgst = r2(cgst + lineTax / 2);
    sgst = r2(sgst + lineTax / 2);
  }

  const exact = r2(taxable + cgst + sgst);
  const total = roundBill(exact);
  return { items, subtotal, discount, taxable, cgst, sgst, total, roundOff: r2(total - exact) };
}

/* ════════════════════════════════════════════════════════════════════════════
   REFUNDS
   ════════════════════════════════════════════════════════════════════════════

   `amountPaid` was computed as `payments.reduce(...)` in FIVE separate places.
   Introducing refunds without a single shared definition of "what does this
   patient actually owe" would mean five chances to get it wrong - and a silently
   wrong balance in a hospital is money that quietly disappears.

   So there is exactly one function. Everything uses it. It is tested.
   ══════════════════════════════════════════════════════════════════════════ */

export class RefundError extends Error {}

export interface MoneyLine { amount: number }

/** Everything actually collected, ignoring anything given back. */
export function grossPaid(payments: MoneyLine[]): number {
  return r2(payments.reduce((s, p) => r2(s + p.amount), 0));
}

/** Everything given back. */
export function totalRefunded(refunds: MoneyLine[]): number {
  return r2(refunds.reduce((s, x) => r2(s + x.amount), 0));
}

/**
 * What the hospital is actually holding for this invoice.
 * THE definition of "paid". Nothing else may redefine it.
 */
export function netPaid(payments: MoneyLine[], refunds: MoneyLine[] = []): number {
  return r2(grossPaid(payments) - totalRefunded(refunds));
}

/** Still owed. Never negative - an overpayment is a refund, not a negative debt. */
export function balanceDue(total: number, payments: MoneyLine[], refunds: MoneyLine[] = []): number {
  return Math.max(0, r2(total - netPaid(payments, refunds)));
}

/**
 * The most that can legally be handed back.
 *
 * THE INVARIANT: you cannot refund money you never collected. Not from a
 * cancelled bill, not from a mistyped amount, not ever. Without this a typo in
 * the refund box empties the till.
 */
export function refundable(payments: MoneyLine[], refunds: MoneyLine[] = []): number {
  return Math.max(0, netPaid(payments, refunds));
}

/* ════════════════════════════════════════════════════════════════════════════
   SPLIT PAYMENTS
   ════════════════════════════════════════════════════════════════════════════

   One bill can be settled across several tenders at the counter - the classic
   case being "₹500 cash and the rest on UPI". The database already allows many
   Payment rows per invoice and every "how much has this bill been paid" number
   already sums across them (grossPaid / netPaid), so a split needs no new
   storage - only this one shared, tested guard, so that no counter can collect
   MORE than the bill in the same breath it is raised.
   ══════════════════════════════════════════════════════════════════════════ */

/** Everything tendered in a single split. Just grossPaid under a clearer name. */
export function sumPayments(payments: MoneyLine[]): number {
  return grossPaid(payments);
}

/**
 * Throws unless a split is legal to collect against a bill of `total`:
 *  · every leg is a positive amount (no ₹0 "cash" line padding the receipt), and
 *  · the legs together do not exceed the bill (a penny of float slack allowed).
 * Under-paying is fine - that just leaves a balance due.
 */
/**
 * Payments that overshoot a whole-rupee total by LESS than a rupee are trimmed
 * to it, not refused. That overshoot is the paise the total no longer has - a
 * screen still showing 102.50 for a bill that is now 102 (an open tab from
 * before the rounding rule, or float noise on a boundary). Taken off the last
 * tender, which is the one a desk types last. A real overpayment - a rupee or
 * more - is left alone for assertPaymentsWithinTotal to refuse.
 */
export function fitTendersToTotal<T extends MoneyLine>(tenders: T[], total: number): T[] {
  const over = r2(sumPayments(tenders) - total);
  if (!tenders.length || over <= 0 || over >= SETTLED_BELOW) return tenders;
  const last = tenders[tenders.length - 1];
  const trimmed = r2(last.amount - over);
  if (trimmed <= 0) return tenders;
  return [...tenders.slice(0, -1), { ...last, amount: trimmed }];
}

export function assertPaymentsWithinTotal(total: number, payments: MoneyLine[]): void {
  for (const p of payments) {
    if (!(p.amount > 0)) throw new InvoiceMathError("Each payment must be more than ₹0");
  }
  if (r2(sumPayments(payments)) > r2(total) + 0.01) {
    throw new InvoiceMathError("Payments can't exceed the bill total");
  }
}

/** Throws unless this exact refund is legal. Called before any money moves. */
export function assertRefundable(
  amount: number,
  reason: string,
  payments: MoneyLine[],
  refunds: MoneyLine[] = []
): void {
  if (!(amount > 0)) throw new RefundError("A refund must be more than ₹0");
  if (!reason || reason.trim().length < 3) {
    // Nobody hands cash across a hospital counter without saying why.
    throw new RefundError("Say why the money is going back");
  }
  const max = refundable(payments, refunds);
  if (max === 0) throw new RefundError("Nothing was ever collected on this bill");
  if (r2(amount) > max) {
    throw new RefundError(`Only ₹${max.toFixed(2)} was collected - you can't refund more than that`);
  }
}

/** PAID / PARTIALLY_PAID / PENDING / REFUNDED - derived, never guessed. */
export function invoiceStatusFrom(
  total: number,
  payments: MoneyLine[],
  refunds: MoneyLine[] = [],
  cancelled = false
): "PENDING" | "PARTIALLY_PAID" | "PAID" | "CANCELLED" | "REFUNDED" {
  if (cancelled) return "CANCELLED";
  const gross = grossPaid(payments);
  const back = totalRefunded(refunds);
  // Everything that came in has gone back out.
  if (back > 0 && r2(back) >= gross && gross > 0) return "REFUNDED";
  const net = r2(gross - back);
  if (net <= 0) return "PENDING";
  if (r2(total - net) < SETTLED_BELOW) return "PAID";
  return "PARTIALLY_PAID";
}

// ---------------------------------------------------------------------------
// THE PRINTED DATE
// ---------------------------------------------------------------------------

export class BillDateError extends Error {}

/**
 * Turn the "YYYY-MM-DD" a desk typed into the timestamp stored in
 * Invoice.billDate - the date the SHEET prints.
 *
 * ANCHORED AT NOON, not midnight, and that is the whole reason this is a
 * function rather than `new Date(s)`. The column is a timestamp; a server in UTC
 * serving a hospital at +05:30 turns local midnight on the 12th into 18:30 on
 * the 11th, so a bill dated the 12th prints as the 11th - on a document the
 * patient hands to an insurer. Noon is the one hour that lands on the right
 * calendar day from either side of the date it belongs to.
 *
 * NO FUTURE DATES. A bill dated next Tuesday is either a typo or an attempt to
 * push revenue into the next return period. The past stays open: back-dating to
 * the day treatment was actually given is the entire point of the field.
 *
 * `undefined` in means "the caller did not send a date" and comes back out
 * unchanged, so Prisma leaves the column alone. `null` means "clear the
 * correction" and puts the sheet back on createdAt.
 *
 * `now` is injectable so the future rule can be tested without waiting for
 * tomorrow.
 */
export function resolveBillDate(
  input: string | null | undefined,
  now: Date = new Date(),
): Date | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;

  const s = input.trim();
  if (!s) throw new BillDateError("That is not a real date & time");

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const dateTimeMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(s);

  if (!dateOnlyMatch && !dateTimeMatch) {
    throw new BillDateError("That is not a real date & time");
  }

  const match = dateOnlyMatch || dateTimeMatch!;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const d = new Date(dateOnlyMatch ? `${s}T12:00:00` : s);
  if (Number.isNaN(d.getTime())) throw new BillDateError("That is not a real date & time");

  if (d.getFullYear() !== year || d.getMonth() + 1 !== month || d.getDate() !== day) {
    throw new BillDateError("That is not a real date & time");
  }

  // A day of slack, not zero: the desk's clock and the server's are never quite
  // the same, and a bill dated "today" must not be refused at 23:58 because the
  // server has already rolled over.
  if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new BillDateError("A bill can't be dated in the future");
  }
  return d;
}

export class ChargeDateError extends Error {}

/** dd-mm-yyyy, h:mm AM/PM - how the ward's own printed tab writes an instant. */
export function wallClock(d: Date): string {
  const h = d.getHours();
  return (
    `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}` +
    `, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
  );
}

/**
 * WHEN A LINE ON THE RUNNING TAB ACTUALLY HAPPENED.
 *
 * `AdmissionCharge.createdAt` is the timestamp the printed tab puts in its
 * "Date & time" column, and it was never really "when the row was created" as
 * far as the family reading that sheet is concerned - it is when the oxygen ran,
 * when the doctor did the round, when the dressing was changed. The ward keys
 * those in whenever it gets a minute, which on a busy morning is all of them at
 * 4pm on the day of discharge. The sheet then shows four days of treatment
 * stamped with one afternoon, in an order nobody performed them in.
 *
 * So the date is correctable, and this is the rule for what may be typed.
 *
 * A FULL INSTANT, not a calendar day, unlike `resolveBillDate` above: the tab
 * prints the time beside the date and the tab is ordered by it, so "the second
 * round, at 6pm" has to be expressible. The client sends an absolute ISO
 * instant, so no timezone reasoning is needed here - only the window.
 *
 * THE WINDOW IS THE STAY ITSELF. A charge before the admission or after the
 * discharge is not a correction, it is a line on the wrong stay, and on a claim
 * it is the first thing a TPA's checker circles. The slack against `now` is for
 * clock skew between the desk's machine and the server, nothing more - unlike a
 * bill date, this one is never legitimately in the future.
 *
 * `now` is injectable so the future rule can be tested without waiting.
 */
export function resolveChargeDate(
  input: string | undefined,
  stay: { admittedAt: Date; dischargedAt: Date | null },
  now: Date = new Date(),
): Date | undefined {
  if (input === undefined) return undefined;

  const d = new Date(input.trim());
  if (Number.isNaN(d.getTime())) throw new ChargeDateError("That is not a real date and time");

  if (d.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new ChargeDateError("A charge can't be dated in the future");
  }
  if (d.getTime() < stay.admittedAt.getTime()) {
    throw new ChargeDateError(
      `This patient was admitted on ${wallClock(stay.admittedAt)} - a charge can't be dated before they were in the bed.`,
    );
  }
  if (stay.dischargedAt && d.getTime() > stay.dischargedAt.getTime()) {
    throw new ChargeDateError(
      `This stay was discharged on ${wallClock(stay.dischargedAt)} - a charge can't be dated after the patient left.`,
    );
  }
  return d;
}

/**
 * THE FLOOR UNDER A CORRECTED BILL.
 *
 * Paid bills are editable - a counter that billed the wrong test to a patient
 * who has already paid needs to correct the paperwork, not void a settled bill
 * and hand back a cancelled receipt. What it must not do is correct the total
 * DOWN past the money in the drawer.
 *
 * That money is real: the patient handed it over and holds a receipt for it. A
 * bill that says less than was taken is an over-collection with nothing anywhere
 * recording it - the day close still counts the payment, the bill no longer
 * explains it, and the difference is discoverable only by somebody adding up two
 * screens. The refund flow exists for giving money back and writes a Refund row
 * that survives; this points at it rather than quietly allowing the gap.
 *
 * Going UP is always fine. The total rises, the balance reappears, the status
 * falls back to PARTIALLY_PAID and the desk collects the difference.
 *
 * `collected` is NET of refunds - money already returned is not money the bill
 * still has to cover.
 */
export function assertTotalCoversCollected(newTotal: number, collected: number): void {
  if (collected <= 0) return;
  // The same paise tolerance assertPaymentsWithinTotal uses. Without it a bill
  // collected to the exact rupee fails on a rounding crumb.
  if (r2(newTotal) < r2(collected) - 0.01) {
    throw new InvoiceMathError(
      `₹${collected.toFixed(2)} has already been collected on this bill, so it can't be corrected to ₹${newTotal.toFixed(2)}. Refund the difference first, then edit.`
    );
  }
}

/**
 * LOWERING THE RECORDED PAYMENTS TO A CORRECTED IPD TOTAL.
 *
 * Only for an inpatient bill re-issued from its stay (see reissueIpdInvoice).
 * Old stays are being keyed in from offline bills, and the discharge box
 * pre-fills the full total - so a stay entered with the wrong dates first comes
 * out "collected" on figures that never existed. Correcting the dates then hit
 * the floor above and the stay could not be fixed at all. The owner's rule
 * (1 Oct 2026): the dates always save, and the recorded payment comes down to
 * the corrected total.
 *
 * Which rows give way: the desk's own payments first, latest first - that is
 * where the pre-filled discharge figure sits - and advance adjustments last,
 * because each of those mirrors a deposit slip the family is holding.
 *
 * Returns only the rows that change. `amount` 0 means the row goes entirely.
 */
export function planPaymentTrim(
  payments: { id: string; amount: number; isAdvance: boolean; createdAt: Date }[],
  excess: number,
): { id: string; from: number; to: number }[] {
  let left = r2(excess);
  if (left <= 0.01) return [];
  const order = [...payments].sort((a, b) =>
    a.isAdvance !== b.isAdvance ? (a.isAdvance ? 1 : -1) : b.createdAt.getTime() - a.createdAt.getTime());
  const plan: { id: string; from: number; to: number }[] = [];
  for (const p of order) {
    if (left <= 0.01) break;
    const cut = Math.min(p.amount, left);
    if (cut <= 0) continue;
    plan.push({ id: p.id, from: r2(p.amount), to: r2(p.amount - cut) });
    left = r2(left - cut);
  }
  return plan;
}
