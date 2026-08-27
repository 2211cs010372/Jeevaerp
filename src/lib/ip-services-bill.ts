/**
 * THE SELF-PAY STAY BILL, SPLIT INTO WHAT CAN BE DISCOUNTED AND WHAT CANNOT.
 *
 * The IP bill (detailed-bill-sheet) prints one gross figure, takes the stay's
 * discount off the bottom of it and asks for the rest. That is the right
 * document for a TPA, who is reading a claim against a policy. It is the WRONG
 * document for the one conversation a self-paying family actually has at the
 * discharge counter, which is about the discount:
 *
 *   The hospital discounts ITS OWN services - the bed, the ward's charges, the
 *   consultant's visits. Those are the hospital's price to set, and the desk
 *   settles a number on them every day.
 *
 *   It does NOT discount medicines or tests. A strip of tablets was bought in at
 *   a price and is sold at the MRP printed on it; a test carries the lab's rate.
 *   Discounting those gives away somebody else's margin.
 *
 * Print the two together with one discount line under the lot and a family reads
 * the discount as applying to all of it, then argues about the pharmacy bill.
 * Print them apart and the answer is on the paper: this block was discounted,
 * this block is at cost, and here is what you already paid at the counter for it.
 *
 * Kept as pure arithmetic, for the same reason insurance-split is: the sheet,
 * the service and the tests all have to agree to the rupee, and money that is
 * added up in three places disagrees in at least one of them.
 *
 * WHAT THIS DOES NOT DO: decide who may see the sheet, or work out where the
 * paid figures came from. It is given the numbers and reports the position.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v);

/**
 * The three blocks the bill is read in.
 *
 * SERVICES is everything the hospital itself did, and is therefore the only
 * discountable one. LAB and PHARMACY are tests and goods billed at their own
 * counters, on their own invoices, at prices this desk does not set.
 */
export type IpBillBucket = "SERVICES" | "LAB" | "PHARMACY";

/**
 * Which block a printed section heading belongs to.
 *
 * Matched on the words rather than against an exact list of titles. The headings
 * are composed in ipd.service ("PHARMACY CHARGES", "LAB INVESTIGATION CHARGES"),
 * and one reworded there must not silently become discountable here - which is
 * exactly what an exact-match table would do the day somebody renamed one.
 */
export function bucketOfSection(title: string): IpBillBucket {
  const t = title.toUpperCase();
  if (t.includes("PHARMAC") || t.includes("MEDICINE") || t.includes("DRUG")) return "PHARMACY";
  if (t.includes("LAB") || t.includes("INVESTIGATION") || t.includes("DIAGNOSTIC")) return "LAB";
  return "SERVICES";
}

/** True where the hospital's own discount may be applied. */
export const isDiscountable = (bucket: IpBillBucket) => bucket === "SERVICES";

export interface IpServicesBillInput {
  /** Every printed section, with the subtotal already on its heading. */
  sections: { title: string; total: number | string }[];
  /** The discount agreed on this stay. Lands on SERVICES only - see below. */
  discount: number | string;
  /** GST off the stay's own invoice. Part of the services block. */
  gst?: number | string;
  /** The deposit taken at admission. */
  advance?: number | string;
  /**
   * Money ALREADY COLLECTED against each block - the counters' own receipts.
   * Services money is what was taken against the stay's invoice, NEVER counting
   * the deposit: that is `advance`, and it would otherwise come off twice.
   */
  paid?: { services?: number | string; lab?: number | string; pharmacy?: number | string };
}

/** One block of the bill: what it came to, what has been paid, what is left. */
export interface IpBillBlock {
  gross: number;
  /** SERVICES only; 0 on the other two, by definition. */
  discount: number;
  /** gross − discount (+ GST on services). What is actually being asked. */
  net: number;
  /** Of that, what has already been collected. Never more than `net`. */
  paid: number;
  /** net − paid, never negative. */
  due: number;
  /** Nothing left on this block. A rounding tail of a paisa counts as settled. */
  settled: boolean;
}

export interface IpServicesBill {
  services: IpBillBlock;
  lab: IpBillBlock;
  pharmacy: IpBillBlock;
  /** Every section added up, before any discount. */
  gross: number;
  /** What was actually taken off - see `discountUnapplied`. */
  discount: number;
  /**
   * The part of the agreed discount that had no services left to come off.
   *
   * Reported rather than spread onto the pharmacy and the lab. A discount bigger
   * than the hospital's own charges means somebody has agreed a number against
   * medicines, and quietly applying it here would print a bill that disagrees
   * with the invoice the counter raised. The sheet says so instead.
   */
  discountUnapplied: number;
  gst: number;
  /** gross − discount + gst. The bill. */
  netBill: number;
  /** Everything already collected at every counter, excluding the deposit. */
  paidTotal: number;
  /** netBill − paidTotal, before the deposit. */
  dueBeforeAdvance: number;
  advance: number;
  /** As much of the deposit as there is a balance to put it against. */
  advanceApplied: number;
  /** THE HEADLINE: what the family pays now. */
  netPayable: number;
  /** Deposit left over once everything is settled - handed back, not kept. */
  refundDue: number;
}

const block = (gross: number, discount: number, gst: number, paid: number): IpBillBlock => {
  const net = r2(Math.max(0, gross - discount + gst));
  // Never credit more than the block came to. An overpayment at the pharmacy
  // window is the pharmacy's to refund; it must not quietly pay down the bed.
  const applied = r2(Math.min(Math.max(0, paid), net));
  const due = r2(Math.max(0, net - applied));
  return { gross: r2(gross), discount: r2(discount), net, paid: applied, due, settled: due <= 0.01 };
};

/**
 * Split a stay's bill into the discounted block and the two that are not.
 *
 * THE DISCOUNT IS CAPPED AT THE SERVICES BLOCK, never carried over. See
 * `discountUnapplied` - the overflow is reported, not spread.
 *
 * THE DEPOSIT COMES OFF LAST, after every counter payment. That is the order the
 * money actually moved in: the family paid the pharmacy window during the stay,
 * and the deposit is settled against whatever is left at discharge. Applying it
 * first would print a refund on a stay that still owes the lab.
 */
export function ipServicesBill(input: IpServicesBillInput): IpServicesBill {
  const totals: Record<IpBillBucket, number> = { SERVICES: 0, LAB: 0, PHARMACY: 0 };
  for (const s of input.sections) {
    const bucket = bucketOfSection(s.title);
    totals[bucket] = r2(totals[bucket] + num(s.total));
  }

  const gst = r2(Math.max(0, num(input.gst)));
  const wanted = r2(Math.max(0, num(input.discount)));
  const discount = r2(Math.min(wanted, totals.SERVICES));

  const services = block(totals.SERVICES, discount, gst, num(input.paid?.services));
  const lab = block(totals.LAB, 0, 0, num(input.paid?.lab));
  const pharmacy = block(totals.PHARMACY, 0, 0, num(input.paid?.pharmacy));

  const gross = r2(totals.SERVICES + totals.LAB + totals.PHARMACY);
  const netBill = r2(services.net + lab.net + pharmacy.net);
  const paidTotal = r2(services.paid + lab.paid + pharmacy.paid);
  const dueBeforeAdvance = r2(services.due + lab.due + pharmacy.due);

  const advance = r2(Math.max(0, num(input.advance)));
  const advanceApplied = r2(Math.min(advance, dueBeforeAdvance));

  return {
    services, lab, pharmacy,
    gross,
    discount,
    discountUnapplied: r2(wanted - discount),
    gst,
    netBill,
    paidTotal,
    dueBeforeAdvance,
    advance,
    advanceApplied,
    netPayable: r2(Math.max(0, dueBeforeAdvance - advanceApplied)),
    refundDue: r2(Math.max(0, advance - advanceApplied)),
  };
}
