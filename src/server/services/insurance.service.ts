import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { logAudit } from "./audit.service";
import { currentInpatients } from "./ipd.service";
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
 */
export interface StayDTO {
  admissionId: string;
  ipNumber: string;
  patient: { id: string; displayId: string; fullName: string; phone: string };
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

export async function insuranceStays(opts?: { includeDischarged?: boolean }): Promise<{ stays: StayDTO[] }> {
  const cutoff = new Date(Date.now() - 90 * 24 * 3_600_000);
  const rows = await prisma.admission.findMany({
    where: {
      payerType: "INSURANCE",
      // Still in a bed, or discharged inside the claim window. Older than that
      // the claim has usually closed, and an unbounded list is one nobody reads.
      OR: [{ status: "ADMITTED" }, { dischargedAt: { gte: cutoff } }],
    },
    orderBy: [{ status: "asc" }, { admittedAt: "desc" }],
    take: 200,
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true,
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
  input: { action: "SUBMIT" | "QUERY" | "APPROVE" | "REJECT" | "SETTLE" | "NOTE"; amount?: number; insurerRef?: string; detail?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<ClaimDetailDTO> {
  const claim = await prisma.insuranceClaim.findUnique({ where: { id }, select: { id: true, status: true, claimedAmount: true, approvedAmount: true } });
  if (!claim) throw new ApiError(404, "Claim not found");

  const now = new Date();
  const data: Prisma.InsuranceClaimUpdateInput = {};
  // store the timeline entry in past tense so it reads as a history, not a verb
  const KIND: Record<string, string> = { SUBMIT: "SUBMITTED", QUERY: "QUERIED", REJECT: "REJECTED", SETTLE: "SETTLED", NOTE: "NOTE" };
  let kind = KIND[input.action] ?? input.action;
  let eventAmount: number | undefined;
  const allowed = (states: ClaimStatus[]) => { if (!states.includes(claim.status)) throw new ApiError(400, `Can't ${input.action.toLowerCase()} a claim that is ${claim.status.toLowerCase().replace(/_/g, " ")}`); };

  switch (input.action) {
    case "SUBMIT":
      allowed(["DRAFT", "QUERIED"]);
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
      break;
    }
    case "NOTE":
      if (!input.detail?.trim()) throw new ApiError(400, "Add a note");
      break;
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.insuranceClaim.update({ where: { id }, data });
    await tx.claimEvent.create({
      data: { claimId: id, kind, detail: input.detail?.trim() || null, amount: eventAmount !== undefined ? eventAmount.toFixed(2) : null, byId: actor.id },
    });
  });

  await logAudit(actor, { action: `CLAIM_${input.action}`, targetTable: "InsuranceClaim", targetId: id, meta: { amount: input.amount, insurerRef: input.insurerRef }, ...ctx });
  return getClaim(id);
}
