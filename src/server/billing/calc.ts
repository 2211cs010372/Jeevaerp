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
 */

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
  total: number;
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

  const total = r2(taxable + cgst + sgst);
  return { items, subtotal, discount, taxable, cgst, sgst, total };
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
  if (net >= total) return "PAID";
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BillDateError("Give the date as YYYY-MM-DD");

  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) throw new BillDateError("That is not a real date");
  // "2026-02-31" parses in some engines by rolling into March. Round-tripping the
  // parsed date back to its parts is what catches a day that does not exist.
  const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (back !== s) throw new BillDateError("That is not a real date");

  // A day of slack, not zero: the desk's clock and the server's are never quite
  // the same, and a bill dated "today" must not be refused at 23:58 because the
  // server has already rolled over.
  if (d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    throw new BillDateError("A bill can't be dated in the future");
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
