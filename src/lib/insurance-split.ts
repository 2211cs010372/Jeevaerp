/**
 * PATIENT MONEY vs INSURANCE MONEY, in one place.
 *
 * The single question this file answers is the one a discharge desk asks out
 * loud: HOW MUCH DOES THIS FAMILY PAY NOW? Until this existed the answer was
 * arrived at by a receptionist reading an approval off the insurance portal,
 * subtracting in their head, and typing the result into a box that started at
 * ₹0 - so the failure mode was silent and one-directional. Nobody types ₹70,000
 * into an empty box they were not prompted to fill, and the family walks.
 *
 * Kept as pure arithmetic, deliberately:
 *
 *   The discharge screen, the ward's running sheet and (next) the server all
 *   have to agree to the rupee. Three implementations of a subtraction is three
 *   chances to disagree, and the one that disagrees is found by a family being
 *   charged twice.
 *
 *   It is testable without a database. The cases that matter here - a rejection,
 *   a part-approval, an advance bigger than the patient's share - are the ones
 *   nobody can produce on demand in a live system.
 *
 * WHAT THIS DOES NOT DO: decide anything. It reports what is owed by whom given
 * a bill and a decision. Whether to collect it, waive it or chase the insurer is
 * the desk's call, and stays on the screens.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The fields of an InsuranceClaim this arithmetic needs. Structural, so both
 *  the DTO the portal serves and a raw Prisma row satisfy it. */
export interface ClaimLike {
  stage: string;
  status: string;
  claimedAmount: string;
  approvedAmount: string | null;
  settledAmount: string | null;
  claimNo?: string;
  insurerRef?: string | null;
}

/** What the insurer has actually committed to on a stay. */
export interface Approval {
  /** The amount approved. 0 unless a claim has been decided in the affirmative. */
  approved: number;
  /** Of that, what has actually reached the bank. */
  settled: number;
  /** The insurer has answered - yes, partly, or no. */
  decided: boolean;
  /** The answer was no. The whole bill is the patient's. */
  rejected: boolean;
  /** No answer yet, or no claim at all. Nothing may be assumed either way. */
  pending: boolean;
  claimNo: string | null;
  ref: string | null;
}

const DECIDED = ["APPROVED", "PARTIALLY_APPROVED", "SETTLED", "REJECTED"];

/**
 * Read the stay's position off its claims.
 *
 * ONLY A DECIDED CLAIM COUNTS. An approval is a number the insurer has
 * committed to; a claim sitting in draft or with the TPA has committed them to
 * nothing, and treating "submitted for ₹1,80,000" as cover is how a family is
 * sent home owing money the insurer later refuses.
 *
 * A pre-auth and a final claim on the same stay are NOT additive - the final
 * claim restates the pre-auth's number against the actual bill. So the final
 * claim wins outright when there is a decided one, and the pre-auth is only
 * consulted while the stay is still running.
 *
 * CLOSED claims are ignored: that status means "this claim was abandoned", and
 * the system opens a ₹0 pre-auth on every insurance admission that frequently
 * ends up exactly there.
 */
export function approvalOf(claims: ClaimLike[] | null | undefined): Approval {
  const none: Approval = {
    approved: 0, settled: 0, decided: false, rejected: false,
    pending: false, claimNo: null, ref: null,
  };
  const live = (claims ?? []).filter((c) => c.status !== "CLOSED");
  if (live.length === 0) return { ...none, pending: true };

  const pick =
    live.find((c) => c.stage === "FINAL" && DECIDED.includes(c.status)) ??
    live.find((c) => DECIDED.includes(c.status)) ??
    live.find((c) => c.stage === "FINAL") ??
    live[0];

  const claimNo = pick.claimNo ?? null;
  const ref = pick.insurerRef ?? null;

  if (!DECIDED.includes(pick.status)) return { ...none, pending: true, claimNo, ref };
  if (pick.status === "REJECTED") return { ...none, decided: true, rejected: true, claimNo, ref };

  return {
    approved: r2(Number(pick.approvedAmount ?? 0)),
    settled: r2(Number(pick.settledAmount ?? 0)),
    decided: true, rejected: false, pending: false,
    claimNo, ref,
  };
}

export interface SplitInput {
  /** The stay's own bill, after any discount. */
  billTotal: number;
  /** Pharmacy and lab already pointed at the insurer. Part of the claim, so
   *  part of what an approval is measured against. */
  claimBillsTotal?: number;
  /** Deposit already held from the family. */
  advance?: number;
  /** A self-paying stay short-circuits every insurance branch below. */
  isInsurance: boolean;
  approval: Approval;
}

export interface Split {
  /** Everything the claim carries - the bill plus the insurer's pharmacy/lab. */
  stayTotal: number;
  /** What the insurer has agreed to, capped at the bill. */
  insuranceApproved: number;
  /** THE HEADLINE. What the family owes, before their own deposit. */
  patientPayable: number;
  /** Their deposit, applied to their share only. */
  advanceApplied: number;
  /** Patient payable − advance. What to ask for at the counter now. */
  patientDue: number;
  /** Approved and not yet in the bank. The hospital's, not the family's. */
  insuranceReceivable: number;
  /** Deposit beyond the family's share - to be handed back, not kept. */
  refundDue: number;
  /** False while a claim is undecided: every figure above is provisional and
   *  no screen may present them as settled. */
  knowsPatientShare: boolean;
}

/**
 * Split a stay's money between the family and the insurer.
 *
 * THE ADVANCE COMES OFF THE PATIENT'S SHARE, NOT OFF THE BILL. This is the
 * subtle one. A ₹1L deposit against a ₹2.5L bill with ₹1.8L approved does not
 * leave the insurer owing ₹1.5L - it leaves the family's ₹70,000 covered and
 * ₹30,000 to hand back. Applying it to the bill instead quietly uses the
 * family's deposit to pay the insurer's share, which is the hospital keeping
 * money it is not owed.
 *
 * WHILE A CLAIM IS UNDECIDED nothing is assumed. patientPayable is 0 and
 * `knowsPatientShare` is false - not because the family owes nothing, but
 * because nobody knows yet, and a confident ₹0 reads as "cleared" to a desk in
 * a hurry. The screens say so in words instead.
 */
export function splitStay(input: SplitInput): Split {
  const bill = r2(Math.max(0, input.billTotal));
  const claimBills = r2(Math.max(0, input.claimBillsTotal ?? 0));
  const advance = r2(Math.max(0, input.advance ?? 0));
  const { approval, isInsurance } = input;

  if (!isInsurance) {
    const payable = bill;
    return {
      stayTotal: payable,
      insuranceApproved: 0,
      patientPayable: payable,
      advanceApplied: r2(Math.min(advance, payable)),
      patientDue: r2(Math.max(0, payable - advance)),
      insuranceReceivable: 0,
      refundDue: r2(Math.max(0, advance - payable)),
      knowsPatientShare: true,
    };
  }

  const stayTotal = r2(bill + claimBills);
  // An insurer cannot approve more of a bill than the bill. A larger approval
  // (a pre-auth agreed against an estimate the stay came in under) covers it in
  // full and no more - the surplus is not the hospital's to invoice.
  const insuranceApproved = r2(Math.min(approval.approved, stayTotal));

  const patientPayable = approval.rejected
    ? stayTotal
    : approval.decided
      ? r2(Math.max(0, stayTotal - insuranceApproved))
      : 0;

  const knowsPatientShare = approval.decided;

  return {
    stayTotal,
    insuranceApproved,
    patientPayable,
    advanceApplied: r2(Math.min(advance, patientPayable)),
    patientDue: r2(Math.max(0, patientPayable - advance)),
    insuranceReceivable: r2(Math.max(0, insuranceApproved - approval.settled)),
    // Suppressed while undecided: "refund ₹1,00,000" on a stay the insurer may
    // yet refuse is the worst thing this file could tell a desk.
    refundDue: knowsPatientShare ? r2(Math.max(0, advance - patientPayable)) : 0,
    knowsPatientShare,
  };
}
