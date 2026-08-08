import { prisma } from "@/lib/prisma";
import { r2 } from "@/server/billing/calc";
import { localDateISO } from "@/lib/date";

/**
 * DAY CLOSE - what should physically be in the drawer right now.
 *
 * At the end of a shift a receptionist counts the cash and hands it over. Until
 * now Jeeva could not tell them what the number *should* be, so the only way to
 * reconcile was to trust the drawer - which is not reconciliation, it's hope.
 *
 * The rule this encodes, and it's the one people get wrong:
 *
 *   CASH IN HAND = cash payments taken − cash refunds given.
 *
 * A refund is not a "negative sale" to be netted off somewhere later. It is money
 * that physically left the drawer, and it must reduce the expected count on the
 * same day it happened, in the same mode it was given back in. UPI refunds do not
 * come out of the cash box; cash refunds do.
 */

export interface ModeTotal {
  mode: string;
  collected: number;
  refunded: number;
  /** collected − refunded. For CASH, this is what should be in the drawer. */
  net: number;
  count: number;
}

/**
 * A TILL is a drawer somebody physically counts at the end of their shift.
 *
 * The question a day close answers is "what should be in MY drawer", so a till is
 * defined by WHO TOOK THE MONEY - not by what the money was for. Those two differ
 * more often than people expect: a lab bill settled at the front desk is lab
 * REVENUE but reception's CASH. Counting it against the lab would leave the
 * receptionist holding ₹520 the system says they don't have, which is exactly the
 * kind of unexplained surplus that makes staff stop trusting the reconciliation.
 *
 * So: the headline number is per till, and each till also shows what its money was
 * FOR (`bySource`), which is how a pharmacist sees that ₹520 of their day was
 * somebody paying off a lab bill at the medicine window.
 */
export type Till = "RECEPTION" | "PHARMACY" | "LAB" | "ADMIN";

/** Which staff roles hand their cash in at which drawer. */
const TILL_ROLES: Record<Till, string[]> = {
  RECEPTION: ["RECEPTIONIST"],
  PHARMACY: ["PHARMACIST"],
  LAB: ["LAB_TECH"],
  ADMIN: ["ADMIN"],
};
export const TILLS = ["RECEPTION", "PHARMACY", "LAB", "ADMIN"] as const;
export const TILL_LABEL: Record<Till, string> = {
  RECEPTION: "Reception",
  PHARMACY: "Pharmacy",
  LAB: "Laboratory",
  ADMIN: "Admin office",
};

/** What a till's money was FOR, as opposed to who took it. */
export interface SourceTotal {
  source: string;
  collected: number;
  refunded: number;
  net: number;
  count: number;
}

export interface DayClose {
  date: string;
  /** Which drawer this statement is for. null = the whole hospital. */
  till: Till | null;
  tillLabel: string;
  /** Every mode, even the ones with no activity - a missing row reads as a bug. */
  modes: ModeTotal[];
  /** What this till's takings were for - consultation, pharmacy, lab, IPD. */
  bySource: SourceTotal[];
  totals: { collected: number; refunded: number; net: number };
  /** The number the receptionist physically counts. */
  cashInHand: number;
  /** Bills this till RAISED today that settle at a counter. Insurance bills are
   *  counted separately below and never folded in here. */
  bills: number;
  refundCount: number;
  /** Per-counter (receptionist) tally - how many payments each took and how much. */
  byCounter: { name: string; count: number; amount: number }[];
  /** Refunds are listed individually - money leaving a hospital gets named. */
  refunds: {
    receiptNo: string; patient: string; amount: number;
    mode: string; reason: string; by: string; at: string;
  }[];
  /** Bills raised today that are still not fully paid. Self-pay only - these are
   *  debts somebody can actually be asked for. */
  outstanding: { receiptNo: string; patient: string; total: number; paid: number; due: number }[];
  /**
   * BILLED TO AN INSURER TODAY. SHOWN, NEVER COUNTED.
   *
   * These are not money and they are not a debt. No cash arrived, so they are
   * absent from `modes`, `totals` and `cashInHand`; and nobody at the desk can
   * collect them, so they are kept out of `outstanding` - a receptionist reading
   * a ₹1.4L "still unpaid" line and going to find a family who owes nothing is
   * exactly the confusion this split exists to prevent.
   *
   * They appear on the statement anyway, in their own block, because the shift
   * genuinely did raise them and a day close that silently omitted a lakh of
   * billing would be the other kind of wrong.
   */
  insurance: { receiptNo: string; patient: string; insurer: string | null; total: number }[];
  insuranceTotal: number;
  /**
   * MONEY INSURERS SENT TODAY, against claims settled earlier.
   *
   * Revenue, and real - but it arrived by bank transfer, so it is absent from
   * `modes`, `totals`, `cashInHand` and `byCounter`. Reported here so a day that
   * banked ₹1.6L of settlements does not read as a day that earned nothing.
   */
  insurerReceipts: number;
  insurerReceiptCount: number;
  /** Masthead for the printed statement. Bundled here rather than fetched
   *  separately so the print sheet needs one round trip and no ADMIN-only
   *  config call - same pattern as opdPrintData / advancePrintData. */
  hospital: { legalName: string; addressLine: string; city: string; state: string; stateCode: string; pincode: string; gstin: string | null; phone: string | null } | null;
}

/**
 * The tender types a HUMAN hands over at a counter.
 *
 * PaymentMode.INSURANCE is deliberately not here. An insurer settling a claim is
 * a bank transfer to the hospital: real revenue, but it never touches a drawer,
 * and a day close answers "what should be in this drawer". Every aggregation
 * below filters it out and it is reported on its own line instead.
 */
const MODES = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"] as const;

/** True for money that actually crossed a counter on somebody's shift. */
const isCounterMode = (m: string) => (MODES as readonly string[]).includes(m);

/** Local-day window. A hospital's day ends at midnight, not at UTC midnight. */
function dayWindow(dateISO?: string) {
  const base = dateISO ? new Date(`${dateISO}T00:00:00`) : new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const to = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  return { from, to };
}

export async function dayClose(opts?: { dateISO?: string; till?: Till }): Promise<DayClose> {
  const { from, to } = dayWindow(opts?.dateISO);
  const till = opts?.till ?? null;

  // Scoped by WHO handled it, not what it was for - see the Till doc above.
  const roles = till ? TILL_ROLES[till] : null;
  const paymentWhere = roles ? { receivedBy: { role: { in: roles as never } } } : {};
  const refundWhere = roles ? { refundedBy: { role: { in: roles as never } } } : {};
  // A bill "belongs" to the counter that raised it, which is not necessarily the
  // counter that got paid - a ward bill raised at reception can be settled at the
  // pharmacy. Bills counted here are the ones this till wrote.
  const invoiceWhere = roles ? { createdBy: { role: { in: roles as never } } } : {};

  const [payments, refunds, invoices, hospital] = await Promise.all([
    prisma.payment.findMany({
      where: { createdAt: { gte: from, lte: to }, ...paymentWhere },
      select: {
        mode: true, amount: true, invoiceId: true,
        receivedBy: { select: { name: true } },
        invoice: { select: { source: true } },
      },
    }),
    prisma.refund.findMany({
      where: { createdAt: { gte: from, lte: to }, ...refundWhere },
      orderBy: { createdAt: "desc" },
      select: {
        mode: true, amount: true, reason: true, createdAt: true,
        refundedBy: { select: { name: true } },
        invoice: { select: { receiptNo: true, source: true, patient: { select: { fullName: true } } } },
      },
    }),
    prisma.invoice.findMany({
      where: { createdAt: { gte: from, lte: to }, ...invoiceWhere },
      select: {
        receiptNo: true, totalAmount: true, status: true,
        payer: true, payerName: true,
        patient: { select: { fullName: true } },
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
      },
    }),
    prisma.hospitalConfig.findFirst(),
  ]);

  type P = {
    mode: string; amount: { toString(): string };
    receivedBy: { name: string } | null;
    invoice: { source: string } | null;
  };
  type R = {
    mode: string; amount: { toString(): string }; reason: string; createdAt: Date;
    refundedBy: { name: string } | null;
    invoice: { receiptNo: string; source: string; patient: { fullName: string } | null } | null;
  };

  const modes: ModeTotal[] = MODES.map((m) => {
    const collected = r2((payments as P[])
      .filter((p) => p.mode === m)
      .reduce((s, p) => r2(s + Number(p.amount.toString())), 0));
    const refunded = r2((refunds as R[])
      .filter((x) => x.mode === m)
      .reduce((s, x) => r2(s + Number(x.amount.toString())), 0));
    return {
      mode: m,
      collected,
      refunded,
      net: r2(collected - refunded),
      count: (payments as P[]).filter((p) => p.mode === m).length,
    };
  });

  // What this till's money was FOR. Every source that moved, plus nothing that
  // didn't - unlike modes, an absent source here is information, not a gap.
  const sourceMap = new Map<string, SourceTotal>();
  const bumpSource = (src: string, collected: number, refunded: number, n: number) => {
    const cur = sourceMap.get(src) ?? { source: src, collected: 0, refunded: 0, net: 0, count: 0 };
    cur.collected = r2(cur.collected + collected);
    cur.refunded = r2(cur.refunded + refunded);
    cur.net = r2(cur.collected - cur.refunded);
    cur.count += n;
    sourceMap.set(src, cur);
  };
  // Counter money only - an insurer's transfer is not this till's takings.
  for (const p of (payments as P[]).filter((x) => isCounterMode(x.mode))) {
    bumpSource(p.invoice?.source ?? "OTHER", Number(p.amount.toString()), 0, 1);
  }
  for (const x of refunds as R[]) bumpSource(x.invoice?.source ?? "OTHER", 0, Number(x.amount.toString()), 0);
  const bySource = [...sourceMap.values()].sort((a, b) => b.net - a.net);

  // per-counter (receptionist) tally - counter money only, or a staff member who
  // recorded an insurer's NEFT appears to have taken ₹1.6L on their shift.
  const counterMap = new Map<string, { name: string; count: number; amount: number }>();
  for (const p of (payments as P[]).filter((x) => isCounterMode(x.mode))) {
    const name = p.receivedBy?.name ?? "\u2014";
    const cur = counterMap.get(name) ?? { name, count: 0, amount: 0 };
    cur.count += 1; cur.amount = r2(cur.amount + Number(p.amount.toString()));
    counterMap.set(name, cur);
  }
  const byCounter = [...counterMap.values()].sort((a, b) => b.amount - a.amount);

  const collected = r2(modes.reduce((s, m) => r2(s + m.collected), 0));
  const refunded = r2(modes.reduce((s, m) => r2(s + m.refunded), 0));

  // The day's bills, split by whether they are a drawer's problem at all. Done
  // once, here, so `bills`, `outstanding` and `insurance` below can never be
  // computed off three different notions of what counts.
  type InvoiceRow = {
    receiptNo: string; totalAmount: { toString(): string }; status: string;
    payer: string; payerName: string | null;
    patient: { fullName: string } | null;
    payments: { amount: { toString(): string } }[];
    refunds: { amount: { toString(): string } }[];
  };
  const live = (invoices as InvoiceRow[]).filter((i) => i.status !== "CANCELLED");
  const selfPayBills = live.filter((i) => i.payer !== "INSURANCE");
  const insuranceBills = live.filter((i) => i.payer === "INSURANCE");

  return {
    hospital,
    date: localDateISO(from),
    till,
    tillLabel: till ? TILL_LABEL[till] : "Whole hospital",
    modes,
    bySource,
    totals: { collected, refunded, net: r2(collected - refunded) },
    // The drawer only ever sees cash. A ₹5,000 UPI refund does not empty it.
    cashInHand: modes.find((m) => m.mode === "CASH")?.net ?? 0,
    bills: selfPayBills.length,
    refundCount: refunds.length,
    byCounter,
    refunds: (refunds as R[]).map((x) => ({
      receiptNo: x.invoice?.receiptNo ?? "-",
      patient: x.invoice?.patient?.fullName ?? "-",
      amount: Number(x.amount.toString()),
      mode: x.mode,
      reason: x.reason,
      by: x.refundedBy?.name ?? "-",
      at: x.createdAt.toISOString(),
    })),
    outstanding: selfPayBills
      .map((i) => {
        const total = Number(i.totalAmount.toString());
        const paid = r2(
          i.payments.reduce((s, p) => r2(s + Number(p.amount.toString())), 0) -
          i.refunds.reduce((s, p) => r2(s + Number(p.amount.toString())), 0)
        );
        return {
          receiptNo: i.receiptNo,
          patient: i.patient?.fullName ?? "-",
          total, paid,
          due: r2(Math.max(0, total - paid)),
        };
      })
      .filter((i) => i.due > 0)
      .sort((a, b) => b.due - a.due),
    insurance: insuranceBills
      .map((i) => ({
        receiptNo: i.receiptNo,
        patient: i.patient?.fullName ?? "-",
        insurer: i.payerName,
        total: Number(i.totalAmount.toString()),
      }))
      .sort((a, b) => b.total - a.total),
    insuranceTotal: r2(
      insuranceBills.reduce((s, i) => r2(s + Number(i.totalAmount.toString())), 0)
    ),
    insurerReceipts: r2(
      (payments as P[])
        .filter((p) => !isCounterMode(p.mode))
        .reduce((s, p) => r2(s + Number(p.amount.toString())), 0)
    ),
    insurerReceiptCount: (payments as P[]).filter((p) => !isCounterMode(p.mode)).length,
  };
}

// ---------------------------------------------------------------------------
// THE ADMIN ROLL-UP - every drawer in the hospital, side by side.
// ---------------------------------------------------------------------------

export interface TillSummary {
  till: Till | "UNASSIGNED";
  label: string;
  collected: number;
  refunded: number;
  /** collected − refunded. The line the owner reads. */
  net: number;
  /** What should physically be in this drawer. */
  cash: number;
  digital: number;
  /** Number of tenders taken, not bills - a split payment is two. */
  payments: number;
  /** Bills this counter raised today that settle at a counter. */
  bills: number;
  /** Bills this counter raised that went to an insurer. Reported, never added
   *  into `collected`, `net` or `cash` - no money crossed this drawer. */
  insuranceBills: number;
  insuranceAmount: number;
  /** Who was on this counter, biggest taker first. */
  staff: { name: string; count: number; amount: number }[];
  /** What this counter's money was for. */
  bySource: SourceTotal[];
}

/**
 * Every till's takings for one day, in a single pass over the day's money.
 *
 * Deliberately one query rather than one per portal: the roll-up must add up to
 * the hospital total exactly, and four independent queries can drift if a payment
 * lands between them. UNASSIGNED catches money taken by somebody whose role maps
 * to no drawer - it should be zero, and if it isn't, the owner needs to see it
 * rather than have it quietly vanish from the reconciliation.
 */
export async function dayCloseByTill(dateISO?: string): Promise<{
  date: string;
  tills: TillSummary[];
  totals: {
    collected: number; refunded: number; net: number; cash: number; payments: number; bills: number;
    /** Deliberately outside `collected` and `net`. See TillSummary.insuranceBills. */
    insuranceBills: number; insuranceAmount: number;
    /** Settlements banked today. Outside `collected` - no drawer saw them. */
    insurerReceipts: number;
  };
}> {
  const { from, to } = dayWindow(dateISO);

  const [payments, refunds, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        mode: true, amount: true,
        receivedBy: { select: { name: true, role: true } },
        invoice: { select: { source: true } },
      },
    }),
    prisma.refund.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: {
        mode: true, amount: true,
        refundedBy: { select: { role: true } },
        invoice: { select: { source: true } },
      },
    }),
    prisma.invoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { payer: true, totalAmount: true, createdBy: { select: { role: true } } },
    }),
  ]);

  const tillOf = (role?: string | null): Till | "UNASSIGNED" => {
    for (const t of TILLS) if (role && TILL_ROLES[t].includes(role)) return t;
    return "UNASSIGNED";
  };

  const blank = (till: Till | "UNASSIGNED"): TillSummary => ({
    till,
    label: till === "UNASSIGNED" ? "Unassigned" : TILL_LABEL[till],
    collected: 0, refunded: 0, net: 0, cash: 0, digital: 0,
    payments: 0, bills: 0, insuranceBills: 0, insuranceAmount: 0, staff: [], bySource: [],
  });

  const acc = new Map<string, TillSummary>();
  const staffAcc = new Map<string, Map<string, { name: string; count: number; amount: number }>>();
  const sourceAcc = new Map<string, Map<string, SourceTotal>>();
  for (const t of [...TILLS, "UNASSIGNED" as const]) {
    acc.set(t, blank(t));
    staffAcc.set(t, new Map());
    sourceAcc.set(t, new Map());
  }

  type P = {
    mode: string; amount: { toString(): string };
    receivedBy: { name: string; role: string } | null;
    invoice: { source: string } | null;
  };
  // Insurer settlements are stripped before ANY of this. A till summary is a
  // drawer, and a bank transfer belongs to no drawer - see MODES.
  const counterPayments = (payments as P[]).filter((p) => isCounterMode(p.mode));
  const insurerPaid = r2(
    (payments as P[]).filter((p) => !isCounterMode(p.mode))
      .reduce((s, p) => r2(s + Number(p.amount.toString())), 0)
  );
  for (const p of counterPayments) {
    const key = tillOf(p.receivedBy?.role);
    const row = acc.get(key)!;
    const amt = Number(p.amount.toString());
    row.collected = r2(row.collected + amt);
    row.payments += 1;
    if (p.mode === "CASH") row.cash = r2(row.cash + amt);
    else row.digital = r2(row.digital + amt);

    const name = p.receivedBy?.name ?? "—";
    const s = staffAcc.get(key)!;
    const cur = s.get(name) ?? { name, count: 0, amount: 0 };
    cur.count += 1; cur.amount = r2(cur.amount + amt);
    s.set(name, cur);

    const src = p.invoice?.source ?? "OTHER";
    const sm = sourceAcc.get(key)!;
    const sc = sm.get(src) ?? { source: src, collected: 0, refunded: 0, net: 0, count: 0 };
    sc.collected = r2(sc.collected + amt); sc.count += 1; sc.net = r2(sc.collected - sc.refunded);
    sm.set(src, sc);
  }

  type R = {
    mode: string; amount: { toString(): string };
    refundedBy: { role: string } | null;
    invoice: { source: string } | null;
  };
  for (const x of refunds as R[]) {
    const key = tillOf(x.refundedBy?.role);
    const row = acc.get(key)!;
    const amt = Number(x.amount.toString());
    row.refunded = r2(row.refunded + amt);
    // A cash refund physically empties this drawer; a UPI refund does not.
    if (x.mode === "CASH") row.cash = r2(row.cash - amt);
    else row.digital = r2(row.digital - amt);

    const src = x.invoice?.source ?? "OTHER";
    const sm = sourceAcc.get(key)!;
    const sc = sm.get(src) ?? { source: src, collected: 0, refunded: 0, net: 0, count: 0 };
    sc.refunded = r2(sc.refunded + amt); sc.net = r2(sc.collected - sc.refunded);
    sm.set(src, sc);
  }

  // `bills` on this roll-up is a COUNTER's output, so it counts what that counter
  // raised to be settled at a counter. An insurance bill went to a TPA, not to
  // this drawer, and is tallied on its own line instead - the owner still sees it,
  // just not inside a column headed by a cash figure.
  for (const inv of invoices as { payer: string; totalAmount: { toString(): string }; createdBy: { role: string } | null }[]) {
    const row = acc.get(tillOf(inv.createdBy?.role))!;
    if (inv.payer === "INSURANCE") {
      row.insuranceBills += 1;
      row.insuranceAmount = r2(row.insuranceAmount + Number(inv.totalAmount.toString()));
    } else {
      row.bills += 1;
    }
  }

  const tills = [...TILLS, "UNASSIGNED" as const].map((t) => {
    const row = acc.get(t)!;
    row.net = r2(row.collected - row.refunded);
    row.staff = [...staffAcc.get(t)!.values()].sort((a, b) => b.amount - a.amount);
    row.bySource = [...sourceAcc.get(t)!.values()].sort((a, b) => b.net - a.net);
    return row;
  })
    // A drawer that saw no money and wrote no bill is noise on this screen. An
    // insurance bill still counts as having written one - a desk whose whole day
    // was cashless admissions must not vanish from the owner's roll-up.
    .filter((r) => r.till !== "UNASSIGNED" || r.collected > 0 || r.refunded > 0 || r.bills > 0 || r.insuranceBills > 0);

  return {
    date: localDateISO(from),
    tills,
    totals: {
      collected: r2(tills.reduce((s, t) => r2(s + t.collected), 0)),
      refunded: r2(tills.reduce((s, t) => r2(s + t.refunded), 0)),
      net: r2(tills.reduce((s, t) => r2(s + t.net), 0)),
      cash: r2(tills.reduce((s, t) => r2(s + t.cash), 0)),
      payments: tills.reduce((s, t) => s + t.payments, 0),
      bills: tills.reduce((s, t) => s + t.bills, 0),
      insuranceBills: tills.reduce((s, t) => s + t.insuranceBills, 0),
      insuranceAmount: r2(tills.reduce((s, t) => r2(s + t.insuranceAmount), 0)),
      insurerReceipts: insurerPaid,
    },
  };
}

/** Invoice sources map to counters: PHARMACY = pharmacy till, LAB = lab till, etc. */
export type CounterSource = "CONSULTATION" | "LAB" | "PHARMACY" | "IPD" | "OTHER";

/**
 * Collections for a day, broken down by payment type (CASH / UPI / CARD / …).
 *
 * This is the "what did this counter take, and in what form" number - the same
 * split reception sees at day-close, but reusable per till. Pass `sources` to
 * scope it to one counter (e.g. the pharmacist only reconciles PHARMACY money);
 * omit it for a hospital-wide view (admin). Refunds are netted per mode and are
 * matched to the counter through the invoice they came from, so a refund handed
 * back at the pharmacy reduces the pharmacy's cash, not reception's.
 */
export async function collectionByMode(opts?: {
  dateISO?: string;
  sources?: readonly CounterSource[];
}): Promise<{
  date: string;
  modes: ModeTotal[];
  totals: { collected: number; refunded: number; net: number; count: number };
}> {
  const { from, to } = dayWindow(opts?.dateISO);
  const sourceWhere =
    opts?.sources && opts.sources.length ? { invoice: { source: { in: [...opts.sources] } } } : {};

  const [payments, refunds] = await Promise.all([
    prisma.payment.findMany({
      where: { createdAt: { gte: from, lte: to }, ...sourceWhere },
      select: { mode: true, amount: true },
    }),
    prisma.refund.findMany({
      where: { createdAt: { gte: from, lte: to }, ...sourceWhere },
      select: { mode: true, amount: true },
    }),
  ]);

  type MA = { mode: string; amount: { toString(): string } };
  const modes: ModeTotal[] = MODES.map((m) => {
    const collected = r2((payments as MA[])
      .filter((p) => p.mode === m)
      .reduce((s, p) => r2(s + Number(p.amount.toString())), 0));
    const refunded = r2((refunds as MA[])
      .filter((x) => x.mode === m)
      .reduce((s, x) => r2(s + Number(x.amount.toString())), 0));
    return {
      mode: m,
      collected,
      refunded,
      net: r2(collected - refunded),
      count: (payments as MA[]).filter((p) => p.mode === m).length,
    };
  });

  const collected = r2(modes.reduce((s, m) => r2(s + m.collected), 0));
  const refunded = r2(modes.reduce((s, m) => r2(s + m.refunded), 0));
  return {
    date: localDateISO(from),
    modes,
    totals: { collected, refunded, net: r2(collected - refunded), count: modes.reduce((s, m) => s + m.count, 0) },
  };
}
