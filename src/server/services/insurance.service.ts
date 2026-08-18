import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { logAudit } from "./audit.service";
import { currentInpatients } from "./ipd.service";
import { splitInvoice } from "@/lib/insurance-split";
import { syncStayCoverage } from "./billing.service";
// One definition of what a corrected bill date is, shared with billing.service
// so the Edit dialog and this page's date control cannot disagree.
import { resolveBillDate, BillDateError } from "@/server/billing/calc";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma, ClaimStatus } from "@prisma/client";

/** Re-exported so the existing API routes keep their import. The list itself
 *  moved to @/lib/insurers when the admission form started needing it too - see
 *  the note there on why it can't live in a server service. */
export { INSURERS } from "@/lib/insurers";

const money = (d: Prisma.Decimal | null | undefined): string | null =>
  d == null ? null : Number(d).toFixed(2);

export interface ClaimListDTO {
  id: string; claimNo: string;
  patient: { id: string; displayId: string; fullName: string };
  insurer: string; policyNo: string;
  type: string; stage: string; status: string;
  claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
  insurerRef: string | null;
  createdAt: string; submittedAt: string | null; updatedAt: string;
}

export interface ClaimEventDTO { kind: string; detail: string | null; amount: string | null; by: string; at: string; }

export interface ClaimDetailDTO extends ClaimListDTO {
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null };
  memberId: string | null; sumInsured: string | null;
  diagnosis: string | null; remarks: string | null;
  admissionId: string | null; invoiceId: string | null;
  decisionAt: string | null; settledAt: string | null;
  events: ClaimEventDTO[];
}

const listSelect = {
  id: true, claimNo: true, insurer: true, policyNo: true, type: true, stage: true, status: true,
  claimedAmount: true, approvedAmount: true, settledAmount: true, insurerRef: true,
  createdAt: true, submittedAt: true, updatedAt: true,
  patient: { select: { id: true, displayId: true, fullName: true } },
} satisfies Prisma.InsuranceClaimSelect;

function toListDTO(r: Prisma.InsuranceClaimGetPayload<{ select: typeof listSelect }>): ClaimListDTO {
  return {
    id: r.id, claimNo: r.claimNo,
    patient: r.patient,
    insurer: r.insurer, policyNo: r.policyNo,
    type: r.type, stage: r.stage, status: r.status,
    claimedAmount: money(r.claimedAmount)!, approvedAmount: money(r.approvedAmount), settledAmount: money(r.settledAmount),
    insurerRef: r.insurerRef,
    createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(),
  };
}

export async function createClaim(
  actor: AuthUser,
  input: {
    patientId: string; insurer: string; policyNo: string; memberId?: string; sumInsured?: number;
    type: "CASHLESS" | "REIMBURSEMENT"; stage: "PRE_AUTH" | "FINAL"; diagnosis?: string;
    claimedAmount: number; admissionId?: string; invoiceId?: string; remarks?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<ClaimDetailDTO> {
  const patient = await prisma.patient.findUnique({ where: { id: input.patientId }, select: { id: true, mergedIntoId: true } });
  if (!patient || patient.mergedIntoId) throw new ApiError(404, "Patient not found");

  const claim = await prisma.$transaction(async (tx) => {
    const claimNo = await nextId("CLAIM", { tx });
    const created = await tx.insuranceClaim.create({
      data: {
        claimNo,
        patientId: input.patientId,
        admissionId: input.admissionId?.trim() || null,
        invoiceId: input.invoiceId?.trim() || null,
        insurer: input.insurer.trim(),
        policyNo: input.policyNo.trim(),
        memberId: input.memberId?.trim() || null,
        sumInsured: input.sumInsured !== undefined ? input.sumInsured.toFixed(2) : null,
        type: input.type,
        stage: input.stage,
        status: "DRAFT",
        diagnosis: input.diagnosis?.trim() || null,
        claimedAmount: input.claimedAmount.toFixed(2),
        remarks: input.remarks?.trim() || null,
        createdById: actor.id,
        events: { create: { kind: "CREATED", detail: `Claim raised for ${input.insurer}`, byId: actor.id } },
      },
      select: { id: true },
    });
    return created;
  });

  await logAudit(actor, { action: "CLAIM_CREATED", targetTable: "InsuranceClaim", targetId: claim.id, meta: { insurer: input.insurer, amount: input.claimedAmount }, ...ctx });
  return getClaim(claim.id);
}

/**
 * WHAT THIS DESK HAS TO RAISE, and hasn't yet.
 *
 * The whole point of the insurance portal. Reception flags a stay as INSURANCE at
 * admission; from that moment there is a claim owed to somebody, and until this
 * list existed the only thing tracking it was a person's memory.
 *
 * Two kinds of work, in the order they become urgent:
 *
 *   PRE_AUTH - they are in a bed right now and no pre-authorization has been
 *     raised. This is the expensive one. A cashless insurer authorizes treatment
 *     BEFORE it happens; a stay that runs three days unauthorized can be refused
 *     in full, and the hospital eats it or bills a family who was promised
 *     cashless. Hours matter, which is why `waitingHours` is on every row.
 *
 *   FINAL - they have gone home, the discharge bill exists, and the actual claim
 *     against it has not been filed. Less urgent per hour, but it is money the
 *     hospital has already spent and not yet asked for.
 *
 * Rows come from the stay, never from a claim, because the failure being caught
 * here is a claim that does not exist.
 */
export interface PendingWorkDTO {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  insurer: string;
  policyNo: string;
  memberId: string | null;
  ward: string;
  bedNo: string;
  admittedAt: string;
  dischargedAt: string | null;
  days: number;
  stage: "PRE_AUTH" | "FINAL";
  /** Running bill for a live stay; the final invoice total once discharged. */
  amount: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  /** Since admission (PRE_AUTH) or since discharge (FINAL). Drives the urgency. */
  waitingHours: number;
  /** The draft already open against this stay, when one exists. */
  claimId: string | null;
  claimNo: string | null;
  /**
   * WHAT IS ACTUALLY MISSING - so the row can offer one button that does the
   * next thing, rather than a generic "open" that makes the desk work out where
   * this particular claim got stuck.
   *
   *   SET_AMOUNT - a draft exists (opened at admission) with no figure on it.
   *   SUBMIT     - it has a figure and has still not gone to the insurer.
   *   RAISE      - no claim at all. Either a stay admitted before pre-auths
   *                opened themselves, or a discharge needing its final claim.
   */
  need: "SET_AMOUNT" | "SUBMIT" | "RAISE";
}

export async function pendingWork(): Promise<{ items: PendingWorkDTO[]; count: number }> {
  const now = Date.now();
  const hoursSince = (d: Date) => Math.max(0, Math.round((now - d.getTime()) / 3_600_000));

  // Every claim already attached to a stay, so a stay can be judged on what it is
  // MISSING. One query rather than a per-admission lookup: this list is read on
  // every page load of the desk's landing screen.
  const claims = await prisma.insuranceClaim.findMany({
    where: { admissionId: { not: null }, status: { not: "CLOSED" } },
    select: { id: true, claimNo: true, admissionId: true, stage: true, status: true, claimedAmount: true },
  });
  const byStay = new Map(claims.map((c) => [`${c.admissionId}:${c.stage}`, c]));

  // ── STILL IN A BED, PRE-AUTH NOT WITH THE INSURER YET ──
  //
  // Since pre-auths open themselves at admission, most rows here are a DRAFT
  // waiting for a figure - not a missing claim. A stay whose pre-auth has been
  // SUBMITTED drops off: it is with the insurer, and waiting on them is not work
  // sitting on this desk.
  //
  // Reuses currentInpatients rather than recomputing a running bill here. The
  // bed-charge arithmetic (started days, transfers, per-ward rates) is subtle and
  // already tested in one place; a second copy would drift within a release.
  const inpatients = await currentInpatients();
  const preAuth: PendingWorkDTO[] = inpatients
    .filter((a) => a.payerType === "INSURANCE")
    .map((a): PendingWorkDTO | null => {
      const claim = byStay.get(`${a.id}:PRE_AUTH`);
      // Submitted, queried, decided - all of it is the insurer's move, not ours.
      if (claim && claim.status !== "DRAFT") return null;
      const need: PendingWorkDTO["need"] = !claim
        ? "RAISE"
        : Number(claim.claimedAmount) > 0 ? "SUBMIT" : "SET_AMOUNT";
      return {
        admissionId: a.id,
        ipNumber: a.ipNumber,
        patient: { id: a.patient.id, displayId: a.patient.displayId, fullName: a.patient.fullName, phone: a.patient.phone },
        insurer: a.insurer ?? "-",
        policyNo: a.policyNo ?? "-",
        memberId: null,
        ward: a.ward,
        bedNo: a.bedNo,
        admittedAt: a.admittedAt,
        dischargedAt: null,
        days: a.days,
        stage: "PRE_AUTH" as const,
        amount: a.runningCharge,
        invoiceId: null,
        invoiceNo: null,
        waitingHours: hoursSince(new Date(a.admittedAt)),
        claimId: claim?.id ?? null,
        claimNo: claim?.claimNo ?? null,
        need,
      };
    })
    .filter((x) => x !== null);

  // ── GONE HOME, BILL RAISED, NO FINAL CLAIM ──
  // Bounded to 90 days. Older than that the claim window has usually closed with
  // the insurer anyway, and an unbounded list would grow into a screen nobody
  // reads - which is the same as having no list.
  const cutoff = new Date(now - 90 * 24 * 3_600_000);
  const closed = await prisma.admission.findMany({
    where: {
      payerType: "INSURANCE",
      status: { not: "ADMITTED" },
      dischargedAt: { gte: cutoff },
    },
    orderBy: { dischargedAt: "desc" },
    select: {
      id: true, ipNumber: true, admittedAt: true, dischargedAt: true,
      insurer: true, policyNo: true, memberId: true, wardNameAtAdmit: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, receiptNo: true, totalAmount: true },
      },
    },
  });

  const final: PendingWorkDTO[] = closed
    .filter((a) => {
      if (a.invoices.length === 0) return false;
      const claim = byStay.get(`${a.id}:FINAL`);
      // A final claim already with the insurer is off this desk's plate; a final
      // claim still in draft is not.
      return !claim || claim.status === "DRAFT";
    })
    .map((a) => {
      const inv = a.invoices[0];
      const end = a.dischargedAt ?? new Date();
      const claim = byStay.get(`${a.id}:FINAL`);
      return {
        admissionId: a.id,
        ipNumber: a.ipNumber,
        patient: a.patient,
        insurer: a.insurer ?? "-",
        policyNo: a.policyNo ?? "-",
        memberId: a.memberId,
        ward: a.wardNameAtAdmit,
        bedNo: a.bed?.bedNo ?? "-",
        admittedAt: a.admittedAt.toISOString(),
        dischargedAt: end.toISOString(),
        days: Math.max(1, Math.ceil((end.getTime() - a.admittedAt.getTime()) / 86_400_000)),
        stage: "FINAL" as const,
        amount: Number(inv.totalAmount).toFixed(2),
        invoiceId: inv.id,
        invoiceNo: inv.receiptNo,
        waitingHours: hoursSince(end),
        claimId: claim?.id ?? null,
        claimNo: claim?.claimNo ?? null,
        need: (!claim
          ? "RAISE"
          : Number(claim.claimedAmount) > 0 ? "SUBMIT" : "SET_AMOUNT") as PendingWorkDTO["need"],
      };
    });

  // Longest wait first, pre-auths ahead of final claims at equal age. The desk
  // works down this list from the top, so the order IS the prioritisation.
  const items = [...preAuth, ...final].sort((a, b) =>
    a.stage === b.stage ? b.waitingHours - a.waitingHours : a.stage === "PRE_AUTH" ? -1 : 1
  );
  return { items, count: items.length };
}

/**
 * EVERY INSURANCE STAY, whether or not it needs anything doing right now.
 *
 * `pendingWork` above answers "what is late"; this answers "who are my patients",
 * and the desk needs both. Without it the only route to a stay's bill was through
 * the pending list - so a stay whose pre-auth had been submitted vanished, and
 * with it any way to reprice or reprint the bill it will be settled on. The work
 * that page exists for outlives the reminder to start it.
 *
 * ── AND SELF-PAYING STAYS TOO, ON REQUEST ──
 *
 * `payerType` records how the stay is BEING BILLED, and this list used to treat
 * it as though it also recorded whether the patient has insurance at all. Those
 * are different questions. A family pays the counter in full because the policy
 * was not produced at admission, or the TPA was not on the panel, or nobody
 * asked - and then claims the money back themselves afterwards. That is the
 * REIMBURSEMENT claim the schema has always had a type for, and the PayerType
 * comment explicitly describes: the drawer really did take the cash, so the bill
 * stays SELF_PAY and a claim is raised beside it.
 *
 * The desk simply had no way to reach those stays. Filtering them out of the one
 * patient list this portal has meant a reimbursement claim could only be raised
 * by searching the patient by name on the claims board and re-typing the stay's
 * details - which is how the wrong admission gets attached to a claim.
 *
 * Cashless stays remain the default, because they are what this desk is
 * ACCOUNTABLE for: an unauthorized cashless stay costs the hospital money, while
 * an unraised reimbursement claim costs the hospital nothing. Self-pay is opt-in
 * so it never buries the work that rots.
 */
export interface StayDTO {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  /**
   * How the stay is being billed. SELF_PAY rows appear only when they were
   * asked for, and the screen must say which kind each row is - "raise a claim"
   * means something different for each.
   */
  payerType: string;
  insurer: string | null;
  policyNo: string | null;
  ward: string;
  bedNo: string;
  admittedAt: string;
  dischargedAt: string | null;
  days: number;
  /** Running bill while in the bed; the final invoice total once discharged. */
  amount: string;
  /** Every claim raised against this stay, newest first. Empty means none yet. */
  claims: { id: string; claimNo: string; stage: string; status: string; claimedAmount: string }[];
}

export async function insuranceStays(opts?: {
  includeDischarged?: boolean;
  /** Which stays to return. Defaults to INSURANCE - see the note above. */
  payer?: "INSURANCE" | "SELF_PAY" | "ALL";
}): Promise<{ stays: StayDTO[] }> {
  const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000);
  const payer = opts?.payer ?? "INSURANCE";
  const rows = await prisma.admission.findMany({
    where: {
      ...(payer === "ALL" ? {} : { payerType: payer }),
      // Still in a bed, or discharged inside the claim window. Older than that
      // the claim has usually closed, and an unbounded list is one nobody reads.
      OR: [{ status: "ADMITTED" }, { dischargedAt: { gte: cutoff } }],
    },
    orderBy: [{ status: "asc" }, { admittedAt: "desc" }],
    take: 200,
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true,
      payerType: true,
      insurer: true, policyNo: true, wardNameAtAdmit: true, dailyChargeAtAdmit: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
      charges: { select: { qty: true, unitPrice: true } },
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" }, take: 1,
        select: { totalAmount: true },
      },
    },
  });

  // Claims are joined in JS, not by `include`: InsuranceClaim.admissionId is a
  // plain column rather than a foreign key (see the model), so Prisma has no
  // relation to traverse. One query for all of them beats one per stay.
  const claimRows = await prisma.insuranceClaim.findMany({
    where: { admissionId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, claimNo: true, stage: true, status: true, claimedAmount: true, admissionId: true },
  });
  const claimsByStay = new Map<string, typeof claimRows>();
  for (const c of claimRows) {
    if (!c.admissionId) continue;
    claimsByStay.set(c.admissionId, [...(claimsByStay.get(c.admissionId) ?? []), c]);
  }

  const now = new Date();
  const days = (from: Date, to: Date) => Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));

  return {
    stays: rows.map((a) => {
      const end = a.dischargedAt ?? now;
      const d = days(a.admittedAt, end);
      // A discharged stay has a real invoice; a live one is quoted at the bed
      // plus its tab, the same arithmetic the ward board shows.
      const running =
        d * Number(a.dailyChargeAtAdmit) +
        a.charges.reduce((s, c) => s + c.qty * Number(c.unitPrice), 0);
      return {
        admissionId: a.id,
        ipNumber: a.ipNumber,
        patient: a.patient,
        payerType: a.payerType,
        insurer: a.insurer,
        policyNo: a.policyNo,
        ward: a.wardNameAtAdmit,
        bedNo: a.bed?.bedNo ?? "-",
        admittedAt: a.admittedAt.toISOString(),
        dischargedAt: a.dischargedAt?.toISOString() ?? null,
        days: d,
        amount: (a.invoices[0] ? Number(a.invoices[0].totalAmount) : running).toFixed(2),
        claims: (claimsByStay.get(a.id) ?? []).map((c) => ({
          id: c.id, claimNo: c.claimNo, stage: c.stage, status: c.status,
          claimedAmount: Number(c.claimedAmount).toFixed(2),
        })),
      };
    }),
  };
}

export async function listClaims(filter: { status?: string; q?: string }): Promise<ClaimListDTO[]> {
  const where: Prisma.InsuranceClaimWhereInput = {};
  if (filter.status && filter.status !== "ALL") {
    if (filter.status === "WITH_INSURER") where.status = { in: ["SUBMITTED", "QUERIED"] };
    else where.status = filter.status as ClaimStatus;
  }
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    where.OR = [
      { claimNo: { contains: q, mode: "insensitive" } },
      { insurer: { contains: q, mode: "insensitive" } },
      { policyNo: { contains: q, mode: "insensitive" } },
      { patient: { fullName: { contains: q, mode: "insensitive" } } },
      { patient: { displayId: { contains: q, mode: "insensitive" } } },
    ];
  }
  const rows = await prisma.insuranceClaim.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, select: listSelect });
  return rows.map(toListDTO);
}

export async function claimStats(): Promise<{
  counts: { draft: number; withInsurer: number; approved: number; settled: number; rejected: number };
  totalClaimed: string; totalApproved: string; totalSettled: string; pendingSettlement: string;
}> {
  const rows = await prisma.insuranceClaim.findMany({
    select: { status: true, claimedAmount: true, approvedAmount: true, settledAmount: true },
  });
  const counts = { draft: 0, withInsurer: 0, approved: 0, settled: 0, rejected: 0 };
  let totalClaimed = 0, totalApproved = 0, totalSettled = 0, pendingSettlement = 0;
  for (const r of rows) {
    const claimed = Number(r.claimedAmount);
    const approved = r.approvedAmount ? Number(r.approvedAmount) : 0;
    const settled = r.settledAmount ? Number(r.settledAmount) : 0;
    totalClaimed += claimed; totalApproved += approved; totalSettled += settled;
    if (r.status === "DRAFT") counts.draft++;
    else if (r.status === "SUBMITTED" || r.status === "QUERIED") counts.withInsurer++;
    else if (r.status === "APPROVED" || r.status === "PARTIALLY_APPROVED") { counts.approved++; pendingSettlement += Math.max(0, approved - settled); }
    else if (r.status === "SETTLED") counts.settled++;
    else if (r.status === "REJECTED") counts.rejected++;
  }
  return {
    counts,
    totalClaimed: totalClaimed.toFixed(2), totalApproved: totalApproved.toFixed(2),
    totalSettled: totalSettled.toFixed(2), pendingSettlement: pendingSettlement.toFixed(2),
  };
}

export async function getClaim(id: string): Promise<ClaimDetailDTO> {
  const r = await prisma.insuranceClaim.findUnique({
    where: { id },
    select: {
      ...listSelect,
      memberId: true, sumInsured: true, diagnosis: true, remarks: true, admissionId: true, invoiceId: true,
      decisionAt: true, settledAt: true,
      patient: { select: { id: true, displayId: true, fullName: true, phone: true, age: true } },
      events: { orderBy: { createdAt: "asc" }, select: { kind: true, detail: true, amount: true, createdAt: true, by: { select: { name: true } } } },
    },
  });
  if (!r) throw new ApiError(404, "Claim not found");
  return {
    ...toListDTO(r as never),
    patient: r.patient,
    memberId: r.memberId, sumInsured: money(r.sumInsured),
    diagnosis: r.diagnosis, remarks: r.remarks, admissionId: r.admissionId, invoiceId: r.invoiceId,
    decisionAt: r.decisionAt?.toISOString() ?? null, settledAt: r.settledAt?.toISOString() ?? null,
    events: r.events.map((e) => ({ kind: e.kind, detail: e.detail, amount: money(e.amount), by: e.by.name, at: e.createdAt.toISOString() })),
  };
}

/** The lifecycle engine. Each action is only valid from certain states, and
 *  every action lands on the timeline. */
export async function actOnClaim(
  actor: AuthUser,
  id: string,
  input: { action: "AMOUNT" | "SUBMIT" | "QUERY" | "APPROVE" | "REJECT" | "SETTLE" | "NOTE"; amount?: number; insurerRef?: string; detail?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<ClaimDetailDTO> {
  const claim = await prisma.insuranceClaim.findUnique({ where: { id }, select: { id: true, status: true, stage: true, claimedAmount: true, approvedAmount: true, admissionId: true, insurer: true } });
  if (!claim) throw new ApiError(404, "Claim not found");

  const now = new Date();
  const data: Prisma.InsuranceClaimUpdateInput = {};
  /**
   * Money the insurer actually sent, to be applied to the stay's bills below.
   * Set only by SETTLE - an approval is a promise, and a promise does not close
   * an invoice.
   */
  let settlementToApply: number | null = null;
  // store the timeline entry in past tense so it reads as a history, not a verb
  const KIND: Record<string, string> = { AMOUNT: "NOTE", SUBMIT: "SUBMITTED", QUERY: "QUERIED", REJECT: "REJECTED", SETTLE: "SETTLED", NOTE: "NOTE" };
  let kind = KIND[input.action] ?? input.action;
  let eventAmount: number | undefined;
  const allowed = (states: ClaimStatus[]) => { if (!states.includes(claim.status)) throw new ApiError(400, `Can't ${input.action.toLowerCase()} a claim that is ${claim.status.toLowerCase().replace(/_/g, " ")}`); };

  switch (input.action) {
    // What the hospital is ASKING for. Editable only while the claim is still
    // the hospital's own - once it is with the insurer the number they are
    // looking at must not change underneath them.
    case "AMOUNT": {
      allowed(["DRAFT", "QUERIED"]);
      const asked = Number(input.amount ?? 0);
      if (!(asked > 0)) throw new ApiError(400, "Enter the amount being claimed");
      data.claimedAmount = asked.toFixed(2);
      eventAmount = asked;
      break;
    }
    case "SUBMIT":
      allowed(["DRAFT", "QUERIED"]);
      // A PRE-AUTH FOR NOTHING IS NOT A PRE-AUTH. The auto-opened draft starts
      // at zero deliberately - an invented estimate would be submitted unread -
      // but submitting that zero asks the insurer to authorise ₹0 and comes
      // back approved for exactly that, which is worse than never sending it.
      if (Number(claim.claimedAmount) <= 0) {
        throw new ApiError(400, "Set the amount being claimed before submitting this to the insurer");
      }
      data.status = "SUBMITTED"; data.submittedAt = now;
      if (input.insurerRef) data.insurerRef = input.insurerRef.trim();
      break;
    case "QUERY":
      allowed(["SUBMITTED"]);
      data.status = "QUERIED";
      break;
    case "APPROVE": {
      allowed(["SUBMITTED", "QUERIED"]);
      const approved = input.amount ?? Number(claim.claimedAmount);
      const partial = approved < Number(claim.claimedAmount);
      data.status = partial ? "PARTIALLY_APPROVED" : "APPROVED";
      data.approvedAmount = approved.toFixed(2); data.decisionAt = now;
      if (input.insurerRef) data.insurerRef = input.insurerRef.trim();
      eventAmount = approved;
      kind = partial ? "PARTIALLY_APPROVED" : "APPROVED";
      break;
    }
    case "REJECT":
      allowed(["SUBMITTED", "QUERIED"]);
      data.status = "REJECTED"; data.decisionAt = now;
      break;
    case "SETTLE": {
      allowed(["APPROVED", "PARTIALLY_APPROVED"]);
      const settled = input.amount ?? (claim.approvedAmount ? Number(claim.approvedAmount) : 0);
      data.status = "SETTLED"; data.settledAmount = settled.toFixed(2); data.settledAt = now;
      eventAmount = settled;
      settlementToApply = settled;
      break;
    }
    case "NOTE":
      if (!input.detail?.trim()) throw new ApiError(400, "Add a note");
      break;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.insuranceClaim.update({ where: { id }, data });
    await tx.claimEvent.create({
      data: {
        claimId: id, kind,
        // A timeline entry with no words is a row that says something happened
        // and refuses to say what. Setting the amount is the one action whose
        // whole content IS the number, so it describes itself when the desk
        // typed no note - the claim's history is read months later by somebody
        // who was not there.
        detail: input.detail?.trim()
          || (input.action === "AMOUNT" && eventAmount !== undefined
            ? `Claim amount set to ₹${eventAmount.toFixed(2)}`
            : null),
        amount: eventAmount !== undefined ? eventAmount.toFixed(2) : null,
        byId: actor.id,
      },
    });

    // ── THE PRE-AUTH THAT NEVER HAPPENED ──
    //
    // Every insurance admission opens a ₹0 DRAFT pre-auth automatically. When
    // the desk skips it - short stay, scheme patient, insurer that only wants a
    // final claim - that draft is never used and never closed, so it sits on the
    // "To raise" list for ever asking for an amount nobody is going to give it.
    // Both settled stays in this hospital left one behind.
    //
    // Once a FINAL claim for the same admission is with the insurer, the pre-auth
    // is moot: authorisation before the fact cannot be sought after the bill has
    // been filed. Closed, not deleted - the row is the record that it was opened.
    if (claim.admissionId && claim.stage === "FINAL" && ["SUBMIT", "APPROVE", "SETTLE"].includes(input.action)) {
      const stale = await tx.insuranceClaim.findMany({
        where: { admissionId: claim.admissionId, stage: "PRE_AUTH", status: "DRAFT", claimedAmount: 0 },
        select: { id: true },
      });
      for (const s of stale) {
        await tx.insuranceClaim.update({ where: { id: s.id }, data: { status: "CLOSED" } });
        await tx.claimEvent.create({
          data: {
            claimId: s.id, kind: "CLOSED",
            detail: "Closed unused - the stay was claimed on its final claim instead",
            byId: actor.id,
          },
        });
      }
    }

    // ── THE APPROVAL SPLITS THE STAY'S BILLS ──
    //
    // This is the moment the ₹20,000 comes into existence. The insurer answers
    // with a NUMBER - "we'll pay ₹1,80,000 of your ₹2,00,000" - and until that
    // number is written onto the bills, the difference is owed by nobody: the
    // dues lists show the family nothing, because a cashless bill is excluded
    // from them, and the hospital never collects it.
    //
    // Allocated oldest-first across the stay's insurance bills, the same order
    // the settlement below uses. A bill past the end of the approval gets zero
    // coverage and becomes wholly the patient's, which is the correct reading of
    // a part-approval.
    //
    // A REJECTION COVERS NOTHING, so the whole stay lands on the family - and
    // now actually shows up at the counter instead of sitting invisible.
    // ONE ALLOCATION RULE, IN ONE PLACE. This used to spread the approval here
    // with its own copy of the arithmetic, which meant a bill raised LATER - on
    // a stay whose insurer had already answered - never got any of it. Both
    // paths now call the same helper, so "why is this bill only half covered"
    // has exactly one answer wherever it is asked from.
    if (["APPROVE", "REJECT"].includes(input.action) && claim.admissionId) {
      await syncStayCoverage(tx, claim.admissionId);
    }

    // ── THE INSURER'S MONEY LANDS ON THE BILLS IT PAID ──
    //
    // Without this, recording a settlement moved a status and nothing else: the
    // stay's invoices stayed PENDING for ever, the money existed in the bank and
    // nowhere in the ERP, and accounts had no way to answer "which bills did
    // this ₹1.6L transfer cover".
    //
    // Applied oldest-first, exactly like a counter payment, and stamped with the
    // insurer's own reference so a bank line can be matched to these invoices
    // months later. Mode INSURANCE keeps it out of every till reconciliation -
    // it is revenue, but it is not in anybody's drawer.
    //
    // A short settlement is left short ON PURPOSE. Whatever the insurer did not
    // pay stays open on the bills, where the desk can see it and decide - the
    // "bill the patient instead" path. Silently writing it off here would lose
    // the hospital the difference with nobody ever seeing a number.
    if (settlementToApply !== null && settlementToApply > 0 && claim.admissionId) {
      const bills = await tx.invoice.findMany({
        where: { admissionId: claim.admissionId, payer: "INSURANCE", status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        select: { id: true, totalAmount: true, payments: { select: { amount: true } }, refunds: { select: { amount: true } } },
      });

      let left = settlementToApply;
      for (const b of bills) {
        if (left <= 0.01) break;
        const paid =
          b.payments.reduce((s, p) => s + Number(p.amount), 0) -
          b.refunds.reduce((s, r) => s + Number(r.amount), 0);
        const owing = Math.round((Number(b.totalAmount) - paid) * 100) / 100;
        if (owing <= 0.01) continue;

        const take = Math.round(Math.min(owing, left) * 100) / 100;
        await tx.payment.create({
          data: {
            invoiceId: b.id,
            mode: "INSURANCE",
            amount: take.toFixed(2),
            reference: [claim.insurer, input.insurerRef?.trim()].filter(Boolean).join(" · ") || null,
            receivedById: actor.id,
          },
        });
        const stillOwing = Math.round((owing - take) * 100) / 100;
        await tx.invoice.update({
          where: { id: b.id },
          data: { status: stillOwing <= 0.01 ? "PAID" : "PARTIALLY_PAID", paidAt: stillOwing <= 0.01 ? now : null },
        });
        left = Math.round((left - take) * 100) / 100;
      }
    }
  });

  await logAudit(actor, { action: `CLAIM_${input.action}`, targetTable: "InsuranceClaim", targetId: id, meta: { amount: input.amount, insurerRef: input.insurerRef }, ...ctx });
  return getClaim(id);
}

/**
 * WHERE THIS STAY STANDS WITH ITS INSURER, and what that means for its bills.
 *
 * The claims desk needs this on the stay's own screen, not on a claims list a
 * click away: the question "has this been approved" and the question "who am I
 * billing" are the same question, and they get asked while looking at the bill.
 */
export interface StayClaimsDTO {
  admissionId: string;
  ipNumber: string;
  payerType: string;
  insurer: string | null;
  policyNo: string | null;
  claims: {
    id: string; claimNo: string; type: string; stage: string; status: string;
    claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
    insurerRef: string | null; submittedAt: string | null; decisionAt: string | null;
  }[];
  /**
   * Bills currently pointed at the insurer, with what has been taken against
   * each. A bill with money on it cannot be moved back to the patient - see
   * revertBillsToSelfPay - so the screen has to be able to say which.
   */
  insuranceBills: { id: string; receiptNo: string; source: string; total: string; paid: string }[];
  insuranceBillsTotal: string;
  /**
   * The insurer has decided and the answer was no, or not all of it - so the
   * shortfall is somebody else's to pay and the desk is being asked to choose.
   * False while a claim is still in draft or still with the insurer: nothing is
   * owed by anyone until they answer.
   */
  needsDecision: boolean;
}

export async function stayClaims(admissionId: string): Promise<StayClaimsDTO> {
  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: { id: true, ipNumber: true, payerType: true, insurer: true, policyNo: true },
  });
  if (!adm) throw new ApiError(404, "Admission not found");

  const [claims, bills] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where: { admissionId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, claimNo: true, type: true, stage: true, status: true,
        claimedAmount: true, approvedAmount: true, settledAmount: true,
        insurerRef: true, submittedAt: true, decisionAt: true,
      },
    }),
    prisma.invoice.findMany({
      where: { admissionId, payer: "INSURANCE", status: { not: "CANCELLED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, receiptNo: true, source: true, totalAmount: true, payments: { select: { amount: true } } },
    }),
  ]);

  const insuranceBills = bills.map((b) => ({
    id: b.id, receiptNo: b.receiptNo, source: b.source,
    total: Number(b.totalAmount).toFixed(2),
    paid: b.payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2),
  }));

  return {
    admissionId: adm.id,
    ipNumber: adm.ipNumber,
    payerType: adm.payerType,
    insurer: adm.insurer,
    policyNo: adm.policyNo,
    claims: claims.map((c) => ({
      id: c.id, claimNo: c.claimNo, type: c.type, stage: c.stage, status: c.status,
      claimedAmount: Number(c.claimedAmount).toFixed(2),
      approvedAmount: c.approvedAmount == null ? null : Number(c.approvedAmount).toFixed(2),
      settledAmount: c.settledAmount == null ? null : Number(c.settledAmount).toFixed(2),
      insurerRef: c.insurerRef,
      submittedAt: c.submittedAt?.toISOString() ?? null,
      decisionAt: c.decisionAt?.toISOString() ?? null,
    })),
    insuranceBills,
    insuranceBillsTotal: insuranceBills.reduce((s, b) => s + Number(b.total), 0).toFixed(2),
    // REJECTED is the obvious one. PARTIALLY_APPROVED counts too: the insurer
    // has settled part and the gap is the patient's, which is a decision nobody
    // is prompted to make unless the screen asks.
    needsDecision:
      insuranceBills.length > 0 &&
      claims.some((c) => c.status === "REJECTED" || c.status === "PARTIALLY_APPROVED") &&
      !claims.some((c) => c.status === "SUBMITTED" || c.status === "QUERIED" || c.status === "DRAFT"),
  };
}

/**
 * SETTLE UP - what the insurer's answer MEANS for the money, on one screen.
 *
 * The answer already existed, per stay, on that stay's own page: `stayClaims`
 * raises `needsDecision` and offers "Bill the patient instead". The problem was
 * that you had to already be looking at the right stay to see it. A refusal
 * arrives by email or by phone, weeks after the patient went home, and until
 * somebody went stay-by-stay through the claims list nothing anywhere said which
 * families now owed money.
 *
 * What happened instead: a bill marked INSURANCE is deliberately excluded from
 * every dues list and every collection total - correctly, because a family owes
 * nothing on a cashless stay. So a REFUSED claim's bills sat pointed at an
 * insurer who had already declined them, invisible to reception, uncollected and
 * uncollectable, until an audit found them. Reception's only recourse was to go
 * digging through billing screens for something that was not there.
 *
 * So this is one list, in three buckets, ordered by what somebody has to DO:
 *
 *   PATIENT_PAYS - the insurer decided and refused, in whole or in part, and
 *     money is still pointed at them. One button moves it onto the patient,
 *     where reception's Billing screen picks it up on its own. Nobody goes and
 *     checks; the work arrives.
 *
 *   WAITING - still with the insurer. Nothing is owed by anybody yet, and the
 *     desk must not be tempted to bill a family while a claim is live.
 *
 *   DONE - settled by the insurer, or already moved onto the patient. Kept
 *     visible rather than hidden, because "did we ever resolve that one" is the
 *     question this screen exists to answer.
 *
 * NOT automatic. A refused pre-auth is argued and re-submitted all the time, and
 * flipping bills the moment a rejection lands would put a family into the dues
 * list while the desk is still on the phone to the TPA. See revertBillsToSelfPay.
 */
export type SettlementBucket = "PATIENT_PAYS" | "WAITING" | "DONE";

export interface SettlementRowDTO {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
  insurer: string | null;
  policyNo: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  /** Every claim on the stay, newest first. */
  claims: {
    id: string; claimNo: string; stage: string; status: string;
    claimedAmount: string; approvedAmount: string | null; settledAmount: string | null;
    decisionAt: string | null;
  }[];
  /** The status the bucket was decided on - the newest decided claim, or the
   *  newest claim if none has been decided. */
  status: string;
  claimed: string;
  approved: string;
  settled: string;
  /** Claimed minus approved: what the insurer would not carry. Never negative. */
  shortfall: string;
  /** Bills still pointed at the insurer. `movable` excludes any with money
   *  already taken against them - those cannot be re-pointed, see
   *  revertBillsToSelfPay - so the screen can promise only what it can deliver. */
  withInsurer: { count: number; total: string; movable: number; movableTotal: string };
  /**
   * Still pointed at the insurer BEYOND what they agreed to carry - the gap
   * somebody has to pay, whatever the claim happens to be labelled. This, not
   * the status, is what puts a stay in PATIENT_PAYS.
   */
  uncovered: string;
  /**
   * Of `uncovered`, what can actually move. Bills move whole, so where a single
   * bill straddles the approval this is smaller than the gap - and where
   * `movableTotal` EXCEEDS this, moving those bills would hand the family an
   * amount the insurer has already agreed to. The screen says so before the
   * button is pressed rather than after.
   */
  atRisk: string;
  /** What the patient ALREADY owes on this stay, their share only. */
  patientDue: string;
  bucket: SettlementBucket;
  /** DONE only: how it ended. The two are not the same event and a desk
   *  reviewing the list months later needs to tell them apart. */
  outcome: "SETTLED_BY_INSURER" | "BILLED_TO_PATIENT" | null;
  /** Days since the insurer decided. How long this has been nobody's job. */
  sinceDecisionDays: number | null;
}

export async function settlementBoard(): Promise<{
  rows: SettlementRowDTO[];
  counts: Record<SettlementBucket, number>;
  /**
   * The same number as `counts.PATIENT_PAYS`, flat. The sidebar badge reads a
   * top-level numeric key off the response body (see portal-shell's badgeCount)
   * and cannot walk into an object - and a badge that silently reads 0 forever
   * is worse than no badge, because it reads as "nothing to do".
   */
  patientPaysCount: number;
  /** What is waiting to be moved onto patients, across the whole list. */
  patientPaysTotal: string;
}> {
  // A year back. Claims genuinely sit for months, so 90 days (as the "to raise"
  // list uses) would drop exactly the old refusals this screen exists to find -
  // but unbounded turns into a screen nobody scrolls, which is the same as no
  // screen at all.
  const cutoff = new Date(Date.now() - 365 * 24 * 3_600_000);

  // `InsuranceClaim.admissionId` is a bare column with no Prisma relation behind
  // it, so the stay cannot be joined in - it is fetched and stitched, the same
  // way pendingWork does it. The date bound goes on the CLAIM rather than the
  // stay for the same reason: claims open at admission, so their createdAt is
  // the stay's date to within hours, and bounding here keeps the whole thing on
  // one indexed table instead of scanning a year of admissions to find the few
  // that carry a claim.
  const claims = await prisma.insuranceClaim.findMany({
    where: { admissionId: { not: null }, createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, claimNo: true, stage: true, status: true, admissionId: true,
      claimedAmount: true, approvedAmount: true, settledAmount: true, decisionAt: true,
    },
  });
  const empty = {
    rows: [] as SettlementRowDTO[],
    counts: { PATIENT_PAYS: 0, WAITING: 0, DONE: 0 },
    patientPaysCount: 0,
    patientPaysTotal: "0.00",
  };
  if (claims.length === 0) return empty;

  const claimedStayIds = [...new Set(claims.map((c) => c.admissionId!))];
  const stays = await prisma.admission.findMany({
    where: { id: { in: claimedStayIds } },
    select: {
      id: true, ipNumber: true, admittedAt: true, dischargedAt: true,
      insurer: true, policyNo: true,
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
    },
  });
  const stayById = new Map(stays.map((s) => [s.id, s]));
  // A claim whose admissionId points at a stay that no longer reads is dropped
  // rather than rendered as a blank row - there is nothing useful to show and
  // nothing to act on.
  const admissionIds = claimedStayIds.filter((id) => stayById.has(id));
  if (admissionIds.length === 0) return empty;

  // ONE query for every bill on every stay in the list. The per-stay version of
  // this screen can afford a lookup each; a board cannot.
  const invoices = await prisma.invoice.findMany({
    where: { admissionId: { in: admissionIds }, status: { not: "CANCELLED" } },
    select: {
      id: true, admissionId: true, payer: true, totalAmount: true, insuranceCoveredAmount: true,
      payments: { select: { mode: true, amount: true } },
      refunds: { select: { amount: true } },
    },
  });

  const billsByStay = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    if (!inv.admissionId) continue;
    const list = billsByStay.get(inv.admissionId) ?? [];
    list.push(inv);
    billsByStay.set(inv.admissionId, list);
  }

  const claimsByStay = new Map<string, typeof claims>();
  for (const c of claims) {
    if (!stayById.has(c.admissionId!)) continue;
    const list = claimsByStay.get(c.admissionId!) ?? [];
    list.push(c);
    claimsByStay.set(c.admissionId!, list);
  }

  const DAY = 86_400_000;
  const n = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));
  const IN_FLIGHT = new Set(["DRAFT", "SUBMITTED", "QUERIED"]);
  const REFUSED = new Set(["REJECTED", "PARTIALLY_APPROVED"]);

  const rows: SettlementRowDTO[] = [];
  for (const admissionId of admissionIds) {
    const cs = claimsByStay.get(admissionId)!;
    const a = stayById.get(admissionId)!;
    const bills = billsByStay.get(admissionId) ?? [];

    const withInsurerBills = bills.filter((b) => b.payer === "INSURANCE");
    // A bill with money on it is already part-collected and cannot be re-pointed
    // without misstating what was taken and from whom.
    const movableBills = withInsurerBills.filter(
      (b) => b.payments.reduce((s, p) => s + Number(p.amount), 0) <= 0.01
    );

    // The patient's own share of the self-pay bills on this stay. Uses the same
    // split every dues list uses, so this figure and reception's agree.
    const patientDue = bills
      .filter((b) => b.payer !== "INSURANCE")
      .reduce((sum, b) => {
        const split = splitInvoice({
          totalAmount: Number(b.totalAmount),
          insuranceCoveredAmount: Number(b.insuranceCoveredAmount),
          payments: b.payments.map((p) => ({ mode: String(p.mode), amount: Number(p.amount) })),
          refunds: b.refunds.map((r) => ({ amount: Number(r.amount) })),
        });
        return sum + split.patientBalance;
      }, 0);

    const decided = cs.filter((c) => c.decisionAt != null || !IN_FLIGHT.has(c.status));
    const lead = decided[0] ?? cs[0];
    const anyInFlight = cs.some((c) => IN_FLIGHT.has(c.status));
    const refused = REFUSED.has(lead.status);

    const claimed = cs.reduce((s, c) => s + n(c.claimedAmount), 0);
    const approved = cs.reduce((s, c) => s + n(c.approvedAmount), 0);
    const settled = cs.reduce((s, c) => s + n(c.settledAmount), 0);

    const withInsurerTotal = withInsurerBills.reduce((s, b) => s + Number(b.totalAmount), 0);
    const movableTotal = movableBills.reduce((s, b) => s + Number(b.totalAmount), 0);

    // ── THE TEST IS MONEY, NOT STATUS ──
    //
    // "REJECTED means the patient pays, SETTLED means we are done" is the
    // obvious rule and it is wrong in the most expensive direction. A claim goes
    // to SETTLED when the insurer's money arrives - for whatever they agreed to,
    // which is routinely less than was asked. The difference stays pointed at
    // the insurer, out of every dues list, and a status-only rule files it under
    // "done" forever.
    //
    // So: what is still aimed at the insurer BEYOND what they agreed to carry.
    // That is the gap somebody has to pay, whatever the claim is labelled.
    const uncovered = Math.max(0, withInsurerTotal - approved);
    // Of that, what can actually be moved. Bills move whole - a bill with money
    // already taken against it stays put, see revertBillsToSelfPay - so this is
    // the honest promise the screen can make.
    const atRisk = Math.min(uncovered, movableTotal);

    let bucket: SettlementBucket;
    let outcome: SettlementRowDTO["outcome"] = null;
    if (anyInFlight) {
      // A live claim NEVER puts a family into the dues list. The desk is still
      // arguing with the TPA and a refused pre-auth is re-submitted all the time.
      bucket = "WAITING";
    } else if (atRisk > 0.01) {
      bucket = "PATIENT_PAYS";
    } else if (approved - settled > 0.01) {
      // They agreed and the money has not arrived. The hospital is owed, the
      // family is not - so it waits here rather than becoming somebody's debt.
      bucket = "WAITING";
    } else {
      bucket = "DONE";
      // Refused with nothing left pointing at the insurer means somebody already
      // moved it. That is a different ending from the insurer paying, and a desk
      // reviewing this list months later has to be able to tell them apart.
      outcome = refused && withInsurerBills.length === 0 ? "BILLED_TO_PATIENT" : "SETTLED_BY_INSURER";
    }

    rows.push({
      admissionId,
      ipNumber: a.ipNumber,
      patient: a.patient,
      insurer: a.insurer,
      policyNo: a.policyNo,
      admittedAt: a.admittedAt.toISOString(),
      dischargedAt: a.dischargedAt?.toISOString() ?? null,
      claims: cs.map((c) => ({
        id: c.id, claimNo: c.claimNo, stage: c.stage, status: c.status,
        claimedAmount: n(c.claimedAmount).toFixed(2),
        approvedAmount: c.approvedAmount == null ? null : n(c.approvedAmount).toFixed(2),
        settledAmount: c.settledAmount == null ? null : n(c.settledAmount).toFixed(2),
        decisionAt: c.decisionAt?.toISOString() ?? null,
      })),
      status: lead.status,
      claimed: claimed.toFixed(2),
      approved: approved.toFixed(2),
      settled: settled.toFixed(2),
      shortfall: Math.max(0, claimed - approved).toFixed(2),
      withInsurer: {
        count: withInsurerBills.length,
        total: withInsurerTotal.toFixed(2),
        movable: movableBills.length,
        movableTotal: movableTotal.toFixed(2),
      },
      uncovered: uncovered.toFixed(2),
      atRisk: atRisk.toFixed(2),
      patientDue: patientDue.toFixed(2),
      bucket,
      outcome,
      sinceDecisionDays: lead.decisionAt
        ? Math.max(0, Math.floor((Date.now() - lead.decisionAt.getTime()) / DAY))
        : null,
    });
  }

  // Longest-refused first inside the action bucket - the one that has been
  // nobody's job the longest is the one most likely to never be collected.
  const order: Record<SettlementBucket, number> = { PATIENT_PAYS: 0, WAITING: 1, DONE: 2 };
  rows.sort((x, y) =>
    order[x.bucket] - order[y.bucket] ||
    (y.sinceDecisionDays ?? -1) - (x.sinceDecisionDays ?? -1) ||
    y.admittedAt.localeCompare(x.admittedAt)
  );

  const needAction = rows.filter((r) => r.bucket === "PATIENT_PAYS");
  return {
    rows,
    counts: {
      PATIENT_PAYS: needAction.length,
      WAITING: rows.filter((r) => r.bucket === "WAITING").length,
      DONE: rows.filter((r) => r.bucket === "DONE").length,
    },
    patientPaysCount: needAction.length,
    // The GAP, not the bill totals: what is genuinely uncollectable today. The
    // headline figure has to be one nobody can accuse the screen of inflating.
    patientPaysTotal: needAction
      .reduce((s, r) => s + Number(r.atRisk), 0)
      .toFixed(2),
  };
}

/**
 * THE OWNER'S VIEW OF THE INSURANCE BOOK.
 *
 * Cashless work is the one revenue stream where treating the patient and being
 * paid for it are months apart, so the questions an owner asks about it are not
 * the ones the day close answers:
 *
 *   how much of my money is sitting with insurers right now
 *   how much have they agreed to, and how much of THAT has actually arrived
 *   how much did they refuse, and which of them refuses most
 *   how long are they taking
 *
 * Deliberately reported gross AND net. "₹4L claimed" flatters; "₹2.6L received"
 * is the number that pays salaries, and the gap between them is the point of the
 * whole screen.
 */
export interface InsuranceAnalyticsDTO {
  /** Rolling totals over every claim ever raised. */
  totals: {
    claims: number;
    claimed: string;
    approved: string;
    settled: string;
    /** Approved, decided, and still not in the bank. */
    awaiting: string;
    /** Claimed but refused outright. */
    rejected: string;
    /** Raised or submitted, no decision yet. */
    inFlight: string;
  };
  /** Claim counts by lifecycle state, for the funnel. */
  funnel: { status: string; count: number; amount: string }[];
  /** One row per insurer, worst payer first by what they still owe. */
  byInsurer: {
    insurer: string; claims: number;
    claimed: string; approved: string; settled: string; awaiting: string; rejected: string;
    /** Approved ÷ claimed, as a percentage. How much of an ask they honour. */
    approvalPct: number;
  }[];
  /** Last 6 months, oldest first - claimed vs settled per month. */
  monthly: { month: string; label: string; claimed: string; settled: string; claims: number }[];
  /** Approved-but-unpaid claims by how long they have been waiting. */
  ageing: { bucket: string; count: number; amount: string }[];
  /** Bills still pointed at an insurer, whether or not a claim covers them. */
  billsWithInsurers: { count: number; amount: string };
}

export async function insuranceAnalytics(): Promise<InsuranceAnalyticsDTO> {
  const [claims, openBills] = await Promise.all([
    prisma.insuranceClaim.findMany({
      select: {
        insurer: true, status: true, createdAt: true, decisionAt: true,
        claimedAmount: true, approvedAmount: true, settledAmount: true,
      },
    }),
    prisma.invoice.findMany({
      where: { payer: "INSURANCE", status: { notIn: ["CANCELLED", "PAID"] } },
      select: { totalAmount: true, payments: { select: { amount: true } } },
    }),
  ]);

  const n = (d: unknown) => (d == null ? 0 : Number(d));
  const f2 = (x: number) => x.toFixed(2);
  const IN_FLIGHT = ["DRAFT", "SUBMITTED", "QUERIED"];

  const sum = (rows: typeof claims, pick: (c: (typeof claims)[number]) => number) =>
    rows.reduce((s, c) => s + pick(c), 0);

  const claimed = sum(claims, (c) => n(c.claimedAmount));
  const approved = sum(claims, (c) => n(c.approvedAmount));
  const settled = sum(claims, (c) => n(c.settledAmount));
  const rejected = sum(claims.filter((c) => c.status === "REJECTED"), (c) => n(c.claimedAmount));
  const inFlight = sum(claims.filter((c) => IN_FLIGHT.includes(c.status)), (c) => n(c.claimedAmount));

  // ── FUNNEL ──
  const funnelMap = new Map<string, { count: number; amount: number }>();
  for (const c of claims) {
    const cur = funnelMap.get(c.status) ?? { count: 0, amount: 0 };
    cur.count += 1; cur.amount += n(c.claimedAmount);
    funnelMap.set(c.status, cur);
  }
  const ORDER = ["DRAFT", "SUBMITTED", "QUERIED", "APPROVED", "PARTIALLY_APPROVED", "SETTLED", "REJECTED", "CLOSED"];
  const funnel = ORDER.filter((s) => funnelMap.has(s)).map((s) => ({
    status: s, count: funnelMap.get(s)!.count, amount: f2(funnelMap.get(s)!.amount),
  }));

  // ── BY INSURER ──
  const insMap = new Map<string, { claims: number; claimed: number; approved: number; settled: number; rejected: number }>();
  for (const c of claims) {
    const k = c.insurer.trim() || "Not recorded";
    const cur = insMap.get(k) ?? { claims: 0, claimed: 0, approved: 0, settled: 0, rejected: 0 };
    cur.claims += 1;
    cur.claimed += n(c.claimedAmount);
    cur.approved += n(c.approvedAmount);
    cur.settled += n(c.settledAmount);
    if (c.status === "REJECTED") cur.rejected += n(c.claimedAmount);
    insMap.set(k, cur);
  }
  const byInsurer = [...insMap.entries()]
    .map(([insurer, v]) => ({
      insurer, claims: v.claims,
      claimed: f2(v.claimed), approved: f2(v.approved), settled: f2(v.settled),
      awaiting: f2(Math.max(0, v.approved - v.settled)),
      rejected: f2(v.rejected),
      approvalPct: v.claimed > 0 ? Math.round((v.approved / v.claimed) * 100) : 0,
    }))
    // Worst payer first: who is sitting on the most of the hospital's money.
    .sort((a, b) => Number(b.awaiting) - Number(a.awaiting) || Number(b.claimed) - Number(a.claimed));

  // ── LAST 6 MONTHS ──
  const monthly: InsuranceAnalyticsDTO["monthly"] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const inMonth = claims.filter((c) => c.createdAt >= from && c.createdAt < to);
    monthly.push({
      month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
      label: from.toLocaleDateString("en-IN", { month: "short" }),
      claimed: f2(sum(inMonth, (c) => n(c.claimedAmount))),
      settled: f2(sum(inMonth, (c) => n(c.settledAmount))),
      claims: inMonth.length,
    });
  }

  // ── AGEING ── approved, decided, still unpaid. Measured from the DECISION,
  // not from when the claim was raised: the clock an insurer is judged on starts
  // when they said yes.
  const waiting = claims.filter(
    (c) => (c.status === "APPROVED" || c.status === "PARTIALLY_APPROVED") && n(c.approvedAmount) - n(c.settledAmount) > 0.01
  );
  const BUCKETS: { bucket: string; min: number; max: number }[] = [
    { bucket: "0-30 days", min: 0, max: 30 },
    { bucket: "31-60 days", min: 30, max: 60 },
    { bucket: "61-90 days", min: 60, max: 90 },
    { bucket: "over 90 days", min: 90, max: Infinity },
  ];
  const ageing = BUCKETS.map((b) => {
    const rows = waiting.filter((c) => {
      const since = c.decisionAt ?? c.createdAt;
      const days = (now.getTime() - since.getTime()) / 86_400_000;
      return days >= b.min && days < b.max;
    });
    return {
      bucket: b.bucket,
      count: rows.length,
      amount: f2(sum(rows, (c) => n(c.approvedAmount) - n(c.settledAmount))),
    };
  });

  // Bills pointed at an insurer with money still on them - the exposure that is
  // real whether or not anybody has got round to raising the claim.
  const billsOpen = openBills.reduce((s, b) => {
    const paid = b.payments.reduce((x, p) => x + Number(p.amount), 0);
    return s + Math.max(0, Number(b.totalAmount) - paid);
  }, 0);

  return {
    totals: {
      claims: claims.length,
      claimed: f2(claimed),
      approved: f2(approved),
      settled: f2(settled),
      awaiting: f2(Math.max(0, approved - settled)),
      rejected: f2(rejected),
      inFlight: f2(inFlight),
    },
    funnel,
    byInsurer,
    monthly,
    ageing,
    billsWithInsurers: { count: openBills.length, amount: f2(billsOpen) },
  };
}

/**
 * EVERY BILL ON A STAY, IN DATE ORDER, WITH THE DATE EDITABLE.
 *
 * An assessor reads a claim chronologically and checks each line against the
 * admission window. A bill dated outside it - a lab test entered the morning
 * after the sample was taken, a pharmacy slip keyed on the following shift -
 * gets that line queried or struck off, and the query costs weeks.
 *
 * The dates go wrong for ordinary reasons: a counter bills at the end of a shift
 * for something done hours earlier, or a bill is raised the next morning for
 * yesterday's ward round. So the desk has to be able to correct them before the
 * claim goes out.
 *
 * `outsideStay` is computed here rather than left to the reader. Comparing eleven
 * timestamps against an admission window by eye is exactly the check people skip.
 */
export interface StayBillDTO {
  id: string;
  receiptNo: string;
  source: string;
  payer: string;
  status: string;
  total: string;
  paid: string;
  createdAt: string;
  /** Dated before admission or after discharge - an insurer will query it. */
  outsideStay: boolean;
  lines: number;
  summary: string;
}

export async function stayBills(admissionId: string): Promise<{
  admittedAt: string;
  dischargedAt: string | null;
  bills: StayBillDTO[];
  outsideCount: number;
  /**
   * THE SAME PATIENT'S OTHER BILLS - the outpatient half of the same person.
   *
   * The claim is the stay, but the file an insurer asks for rarely stops there:
   * the OP consultation where the condition was first diagnosed, the scan billed
   * at the counter a week before admission, the walk-in pharmacy sale on the way
   * home, an earlier admission on a readmission claim. None of those carry this
   * admissionId, so none of them appeared on this screen at all - and the desk
   * either printed them out of reception's login or did not attach them.
   *
   * Deliberately a SEPARATE list, not folded into `bills`. That list is the
   * claim, and every row on it is checked against the admission window; mixing
   * in bills that are *supposed* to fall outside that window would turn the
   * `outsideStay` flag - the entire point of the list - into noise.
   */
  otherBills: StayBillDTO[];
}> {
  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: { admittedAt: true, dischargedAt: true, patientId: true },
  });
  if (!adm) throw new ApiError(404, "Admission not found");

  const billSelect = {
    id: true, receiptNo: true, source: true, payer: true, status: true,
    totalAmount: true, createdAt: true, billDate: true,
    payments: { select: { amount: true } },
    items: { select: { description: true }, orderBy: { id: "asc" } },
  } as const;

  const [rows, others] = await Promise.all([
    prisma.invoice.findMany({
      where: { admissionId, status: { not: "CANCELLED" } },
      orderBy: { createdAt: "asc" },
      select: billSelect,
    }),
    prisma.invoice.findMany({
      where: {
        patientId: adm.patientId,
        status: { not: "CANCELLED" },
        OR: [{ admissionId: null }, { admissionId: { not: admissionId } }],
      },
      // Newest first - on this list the relevant bill is the recent one, which
      // is the opposite of the claim list where the story reads forwards.
      orderBy: { createdAt: "desc" },
      take: 60,
      select: billSelect,
    }),
  ]);

  // The window a bill has to fall inside. Open-ended while the patient is still
  // in a bed - nothing raised today can be "after discharge" if there has been
  // no discharge.
  const from = adm.admittedAt;
  const to = adm.dischargedAt;

  /** One invoice, flattened for the screen. A null `window` means this bill was
   *  never claimed to be on the stay, so it cannot be "outside" it. */
  const flatten = (r: (typeof rows)[number], window: { from: Date; to: Date | null } | null): StayBillDTO => {
    const first = r.items[0];
    const more = r.items.length - 1;
    // THE DATE THE ASSESSOR WILL SEE. A corrected billDate is what the printed
    // bill in the claim file carries, so it is what this screen shows and what
    // the outside-the-stay flag has to judge - flagging on `createdAt` would
    // mark a bill as outside the stay that the assessor is holding proof is
    // inside it, and leave a genuinely stray one unflagged the moment somebody
    // re-dated it.
    const effective = r.billDate ?? r.createdAt;
    return {
      id: r.id, receiptNo: r.receiptNo, source: r.source, payer: r.payer, status: r.status,
      total: Number(r.totalAmount).toFixed(2),
      paid: r.payments.reduce((s, p) => s + Number(p.amount), 0).toFixed(2),
      createdAt: effective.toISOString(),
      // Compared on the DAY, not the instant: a bill raised at 23:55 on the
      // discharge date is inside the stay by any reading an assessor would use.
      outsideStay: window
        ? effective < startOfDay(window.from) || (window.to !== null && effective > endOfDay(window.to))
        : false,
      lines: r.items.length,
      summary: first ? `${first.description.split("·")[0].trim()}${more > 0 ? ` + ${more} more` : ""}` : "\u2014",
    };
  };

  const bills: StayBillDTO[] = rows.map((r) => flatten(r, { from, to }));

  return {
    admittedAt: adm.admittedAt.toISOString(),
    dischargedAt: adm.dischargedAt?.toISOString() ?? null,
    bills,
    outsideCount: bills.filter((b) => b.outsideStay).length,
    otherBills: others.map((r) => flatten(r, null)),
  };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

/**
 * Correct the date a bill is dated.
 *
 * Deliberately narrow: it moves the bill's DATE and nothing else. It cannot be
 * used on a bill that carries an IRN - a government-registered invoice is a
 * document somebody else holds a copy of, and re-dating it here would put this
 * system out of step with theirs.
 *
 * ── IT WRITES billDate, NOT createdAt ──
 *
 * It used to assign `createdAt` directly, and that was a quiet way to lose
 * money. `createdAt` is what the day close, the collection report and every GST
 * return group by (reports.service filters it between two dates), so re-dating a
 * bill by three days moved its money out of one day's takings and into
 * another's - the till stopped matching the drawer for two days at once, and
 * nothing on any screen said why. An insurance desk tidying a claim file has no
 * reason to be rewriting the hospital's daily collection.
 *
 * `billDate` is the column that exists for exactly this: it is what the printed
 * sheet shows, `createdAt` stays the untouched record of when the bill was
 * really raised, and the two are separately visible. It is also the same column
 * the Edit dialog writes, so the date control on this page and the date field in
 * that dialog now mean one thing rather than two.
 *
 * The old date is kept in the audit log, because "the bill was re-dated after
 * the treatment" is a question an insurer is entitled to ask.
 */
export async function redateBill(
  actor: AuthUser,
  input: { invoiceId: string; date: string; reason?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ receiptNo: string; from: string; to: string }> {
  const inv = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true, receiptNo: true, createdAt: true, billDate: true, status: true,
      eInvoice: { select: { status: true } },
    },
  });
  if (!inv) throw new ApiError(404, "Bill not found");
  if (inv.status === "CANCELLED") throw new ApiError(409, "That bill is cancelled");
  if (inv.eInvoice?.status === "GENERATED") {
    throw new ApiError(409, "This bill is registered with an IRN. Its date is fixed with the government, not here.");
  }
  // The paid-bill refusal that used to sit here is GONE, and deliberately. It
  // existed because this wrote `createdAt` - moving a settled bill's money to a
  // different day really was indefensible. Writing `billDate` moves no money at
  // all: it corrects the date on the paper and leaves the takings where they
  // were. The desk that may now correct a paid bill's lines had no way to
  // correct its date, which was the odd half of the rule rather than the safe
  // one. The Edit dialog and this control now agree.

  // Date only. The corrected date is a DAY, not a moment - see resolveBillDate
  // for why it is anchored at noon rather than at midnight.
  let next: Date;
  try {
    next = resolveBillDate(input.date)!;
  } catch (e) {
    if (e instanceof BillDateError) throw new ApiError(400, e.message);
    throw e;
  }

  const before = inv.billDate ?? inv.createdAt;
  await prisma.invoice.update({ where: { id: inv.id }, data: { billDate: next } });
  await logAudit(actor, {
    action: "INVOICE_REDATED", targetTable: "Invoice", targetId: inv.id,
    meta: {
      receiptNo: inv.receiptNo,
      from: before.toISOString(),
      to: next.toISOString(),
      // The real clock, recorded alongside, so the log answers "was this bill
      // re-dated away from the day it was actually raised" without a join.
      raisedAt: inv.createdAt.toISOString(),
      reason: input.reason?.trim() || null,
    },
    ...ctx,
  });

  return { receiptNo: inv.receiptNo, from: before.toISOString(), to: next.toISOString() };
}
