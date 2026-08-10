import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { logAudit } from "./audit.service";
import { splitInvoice } from "@/lib/insurance-split";
import { createInvoice, recordPayment, getInvoice, advancePaymentRef, type PaymentModeT } from "./billing.service";
import { notifyAdmitted, notifyDischarged, notifyAdvanceReceived } from "./notify.service";
// One rounding definition across the whole system - money must not be
// rounded two different ways in two different files.
import { r2 as round2 } from "@/server/billing/calc";
import { getSettings } from "./admin.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { mergeAdvice } from "@/lib/advised-lab";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma, PaymentMode, ChargeCategory } from "@prisma/client";
import {
  CLOSED_STATUS_LIST, isClosed, OUTCOME_LABEL,
  type AdmissionStatusValue, type DischargeOutcome,
} from "@/lib/admission-outcome";

// ---------------------------------------------------------------------------
// IPD - inpatient admissions.
//
// The shape of the flow: pick the patient by their Jeeva ID, check the bed
// board, admit them onto an AVAILABLE bed with an attending doctor and the
// caring person's details. The bed flips OCCUPIED. On discharge, the stay is
// billed (days × the rate snapshotted at admission), the bed is freed, and
// the case is closed. Nothing is ever deleted.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Charged per started day, minimum 1 - standard hospital practice. */
export function stayDays(admittedAt: Date, until: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - admittedAt.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------------------
// Wards & beds (setup lives with admin; the board is for everyone clinical)
// ---------------------------------------------------------------------------

export async function upsertWard(
  actor: AuthUser,
  input: { id?: string; name: string; category: string; floor?: string; dailyCharge: number; gstRatePct: number; active?: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const data = {
    name: input.name.trim(),
    category: input.category.trim().toUpperCase(),
    floor: input.floor?.trim() || null,
    dailyCharge: input.dailyCharge.toFixed(2),
    gstRatePct: input.gstRatePct.toFixed(2),
    active: input.active ?? true,
  };
  if (input.id) {
    await prisma.ward.update({ where: { id: input.id }, data });
    await logAudit(actor, { action: "WARD_UPDATED", targetTable: "Ward", targetId: input.id, meta: { dailyCharge: input.dailyCharge }, ...ctx });
  } else {
    const w = await prisma.ward.create({ data, select: { id: true } });
    await logAudit(actor, { action: "WARD_CREATED", targetTable: "Ward", targetId: w.id, meta: { name: data.name }, ...ctx });
  }
}

/** Add N beds to a ward, auto-numbered after the highest existing number. */
export async function addBeds(
  actor: AuthUser,
  input: { wardId: string; count: number; prefix?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  if (input.count < 1 || input.count > 50) throw new ApiError(400, "Add between 1 and 50 beds at a time");
  const ward = await prisma.ward.findUnique({ where: { id: input.wardId }, select: { id: true, name: true, beds: { select: { bedNo: true } } } });
  if (!ward) throw new ApiError(404, "Ward not found");

  const prefix = (input.prefix ?? ward.name.slice(0, 3).toUpperCase()).replace(/\s/g, "");
  const existingNums = (ward.beds as { bedNo: string }[])
    .map((b) => Number(b.bedNo.replace(/^\D+/, "")))
    .filter((n) => !Number.isNaN(n));
  let next = existingNums.length ? Math.max(...existingNums) + 1 : 1;

  await prisma.bed.createMany({
    data: Array.from({ length: input.count }, () => ({
      wardId: input.wardId,
      bedNo: `${prefix}-${String(next++).padStart(2, "0")}`,
    })),
  });
  await logAudit(actor, { action: "BEDS_ADDED", targetTable: "Ward", targetId: input.wardId, meta: { count: input.count }, ...ctx });
}

export async function setBedStatus(
  actor: AuthUser,
  input: { bedId: string; status: "AVAILABLE" | "MAINTENANCE" },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const bed = await prisma.bed.findUnique({ where: { id: input.bedId }, select: { id: true, status: true } });
  if (!bed) throw new ApiError(404, "Bed not found");
  if (bed.status === "OCCUPIED") throw new ApiError(400, "That bed is occupied - discharge the patient first");
  await prisma.bed.update({ where: { id: input.bedId }, data: { status: input.status } });
  await logAudit(actor, { action: "BED_STATUS_SET", targetTable: "Bed", targetId: input.bedId, meta: { status: input.status }, ...ctx });
}

/**
 * The bed board: every ward, every bed, who's in it. This is the availability
 * check - reception admits straight off this screen.
 */
export async function bedBoard(): Promise<{
  summary: { total: number; available: number; occupied: number; maintenance: number };
  wards: {
    id: string; name: string; category: string; floor: string | null;
    dailyCharge: string; gstRatePct: string; available: number; total: number;
    beds: {
      id: string; bedNo: string; status: string;
      /**
       * `days` is the stay so far, counted the way the bill counts it
       * (stayDays - per started day, minimum 1), so the number on the board is
       * the number the family is being charged for and the two can't disagree.
       */
      patient: {
        displayId: string; fullName: string; ipNumber: string; admissionId: string;
        admittedAt: string; days: number;
      } | null;
    }[];
  }[];
}> {
  const wards = await prisma.ward.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, category: true, floor: true, dailyCharge: true, gstRatePct: true,
      beds: {
        orderBy: { bedNo: "asc" },
        select: {
          id: true, bedNo: true, status: true,
          admissions: {
            where: { status: "ADMITTED" },
            take: 1,
            select: { id: true, ipNumber: true, admittedAt: true, patient: { select: { displayId: true, fullName: true } } },
          },
        },
      },
    },
  });

  type WardRow = {
    id: string; name: string; category: string; floor: string | null;
    dailyCharge: { toString(): string }; gstRatePct: { toString(): string };
    beds: { id: string; bedNo: string; status: string; admissions: { id: string; ipNumber: string; admittedAt: Date; patient: { displayId: string; fullName: string } }[] }[];
  };

  // One clock for the whole board: computing "now" per bed would let two beds
  // admitted in the same minute tick over to a new day at different moments.
  const now = new Date();
  let total = 0, available = 0, occupied = 0, maintenance = 0;
  const mapped = (wards as WardRow[]).map((w) => {
    const beds = w.beds.map((b) => {
      total++;
      if (b.status === "AVAILABLE") available++;
      else if (b.status === "OCCUPIED") occupied++;
      else maintenance++;
      const adm = b.admissions[0];
      return {
        id: b.id, bedNo: b.bedNo, status: b.status,
        patient: adm
          ? {
              displayId: adm.patient.displayId, fullName: adm.patient.fullName,
              ipNumber: adm.ipNumber, admissionId: adm.id,
              admittedAt: adm.admittedAt.toISOString(), days: stayDays(adm.admittedAt, now),
            }
          : null,
      };
    });
    return {
      id: w.id, name: w.name, category: w.category, floor: w.floor,
      dailyCharge: w.dailyCharge.toString(), gstRatePct: w.gstRatePct.toString(),
      available: beds.filter((b) => b.status === "AVAILABLE").length,
      total: beds.length,
      beds,
    };
  });

  return { summary: { total, available, occupied, maintenance }, wards: mapped };
}

// ---------------------------------------------------------------------------
// Admissions
// ---------------------------------------------------------------------------

export async function admitPatient(
  actor: AuthUser,
  input: {
    patientDisplayId: string;
    bedId: string;
    doctorId: string;          // the attending / referred doctor inside the hospital
    reason?: string;
    attendantName?: string;    // the caring person
    attendantPhone?: string;
    attendantRelation?: string;
    notes?: string;
    /**
     * Who settles this stay. Defaults to SELF_PAY so a desk that never touches
     * the toggle keeps admitting exactly as before.
     *
     * Asked here and nowhere else. This one field is the entire handoff to the
     * insurance room: it is what makes the stay appear on their list, and the
     * only alternative to it is somebody remembering to walk down the corridor.
     */
    payerType?: "SELF_PAY" | "INSURANCE";
    insurer?: string;
    policyNo?: string;
    memberId?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ admissionId: string; ipNumber: string; bedNo: string; ward: string }> {
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const patient = await tx.patient.findUnique({
      where: { displayId: input.patientDisplayId.toUpperCase() },
      select: { id: true, displayId: true, fullName: true, phone: true, mergedIntoId: true, deletedAt: true },
    });
    if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "Patient not found - check the Jeeva ID");

    // One active admission per patient. A person cannot be in two beds.
    const already = await tx.admission.findFirst({
      where: { patientId: patient.id, status: "ADMITTED" },
      select: { ipNumber: true },
    });
    if (already) throw new ApiError(409, `${patient.fullName} is already admitted (${already.ipNumber})`);

    // Claim the bed atomically - two receptionists racing for the last ICU
    // bed must not both win.
    const claim = await tx.bed.updateMany({
      where: { id: input.bedId, status: "AVAILABLE" },
      data: { status: "OCCUPIED" },
    });
    if (claim.count === 0) throw new ApiError(409, "That bed was just taken or is unavailable - pick another from the board");

    const bed = await tx.bed.findUnique({
      where: { id: input.bedId },
      select: { bedNo: true, ward: { select: { name: true, dailyCharge: true, gstRatePct: true } } },
    });
    if (!bed) throw new ApiError(404, "Bed not found");

    const doctor = await tx.doctor.findUnique({ where: { id: input.doctorId }, select: { id: true } });
    if (!doctor) throw new ApiError(404, "Doctor not found");

    const ipNumber = await nextId("IP", { tx });
    const nn = (v?: string) => (v && v.trim() ? v.trim() : null);

    // An insurance stay with no insurer and no policy number is not an insurance
    // stay - it is a stay the desk half-flagged. The insurance room would see a
    // row it cannot act on, and would have to ring the ward to find out who the
    // insurer even is. Refuse it here, while the family is still at the desk with
    // the card in their hand.
    const payerType = input.payerType ?? "SELF_PAY";
    if (payerType === "INSURANCE" && (!nn(input.insurer) || !nn(input.policyNo))) {
      throw new ApiError(400, "An insurance admission needs the insurer and the policy number");
    }

    const adm = await tx.admission.create({
      data: {
        ipNumber,
        patientId: patient.id,
        bedId: input.bedId,
        doctorId: input.doctorId,
        reason: nn(input.reason),
        attendantName: nn(input.attendantName),
        attendantPhone: nn(input.attendantPhone),
        attendantRelation: nn(input.attendantRelation),
        payerType,
        // Cleared on a self-pay stay rather than stored and ignored: a policy
        // number left behind by a mis-click would put the stay on the insurance
        // desk's list forever.
        insurer: payerType === "INSURANCE" ? nn(input.insurer) : null,
        policyNo: payerType === "INSURANCE" ? nn(input.policyNo) : null,
        memberId: payerType === "INSURANCE" ? nn(input.memberId) : null,
        dailyChargeAtAdmit: bed.ward.dailyCharge,
        wardNameAtAdmit: bed.ward.name,
        gstRatePctAtAdmit: bed.ward.gstRatePct,
        admittedById: actor.id,
      },
      select: { id: true },
    });

    // An admission note opens the chronology like any other entry, with the
    // admitting user's name on it - not as a string on the stay that the next
    // shift would overwrite.
    if (nn(input.notes)) {
      await tx.admissionNote.create({
        data: { admissionId: adm.id, body: input.notes!.trim(), kind: "NURSING", authorId: actor.id },
      });
    }

    // ── THE PRE-AUTHORIZATION OPENS ITSELF ──
    //
    // A cashless insurer authorizes treatment BEFORE it happens. A stay that
    // runs three days unauthorized can be refused in full, and then either the
    // hospital eats it or a family who was promised cashless gets a bill.
    //
    // So the claim is not something the insurance desk has to REMEMBER to start.
    // It exists from the moment the bed is assigned, in the same transaction, as
    // a DRAFT with no amount on it yet - because at admission nobody honestly
    // knows what the stay will cost. The desk's job becomes filling in a figure
    // and submitting, which is work that shows up on a list, rather than
    // remembering that a patient exists, which is work that does not.
    //
    // Written with tx directly rather than through insurance.service: that
    // module already imports this one, and it has to be atomic with the
    // admission anyway - an admission that committed without its claim would be
    // exactly the silent gap this removes.
    if (payerType === "INSURANCE") {
      const claimNo = await nextId("CLAIM", { tx });
      await tx.insuranceClaim.create({
        data: {
          claimNo,
          patientId: patient.id,
          admissionId: adm.id,
          insurer: nn(input.insurer)!,
          policyNo: nn(input.policyNo)!,
          memberId: nn(input.memberId),
          type: "CASHLESS",
          stage: "PRE_AUTH",
          status: "DRAFT",
          // Zero, not a guess. An estimate invented by the system would be
          // submitted unread by somebody in a hurry, and a pre-auth for the
          // wrong amount is worse than one that visibly still needs a number.
          claimedAmount: "0.00",
          createdById: actor.id,
          events: {
            create: {
              kind: "CREATED",
              detail: `Opened automatically on admission (${ipNumber}) - needs an amount before it can be submitted`,
              byId: actor.id,
            },
          },
        },
      });
    }

    await logAudit(actor, {
      action: "PATIENT_ADMITTED", targetTable: "Admission", targetId: adm.id,
      meta: {
        ipNumber, patient: patient.displayId, bed: bed.bedNo, ward: bed.ward.name,
        // Who the bill was pointed at, decided at the desk. If a stay is later
        // billed to an insurer nobody agreed to, this is the record of what was
        // actually said at admission.
        payerType,
        insurer: payerType === "INSURANCE" ? nn(input.insurer) : undefined,
      }, ...ctx,
    }, tx);

    return {
      admissionId: adm.id, ipNumber, bedNo: bed.bedNo, ward: bed.ward.name,
      patientName: patient.fullName, patientPhone: patient.phone,
    };
  });

  // A bed just went from free to occupied. Every ward board in the building is
  // now wrong until it hears this - and if the family handed over an insurance
  // card, the insurance room now has a pre-auth to raise and no other way to
  // find out about it.
  await publishLive(
    [TOPICS.IPD, TOPICS.RECEPTION, TOPICS.ADMIN, TOPICS.INSURANCE],
    EVENTS.ADMISSION_OPENED
  );

  // TO THE ATTENDANT WHEN THERE IS ONE, otherwise the patient's own number.
  // The person being admitted may be in no state to read a text; the attendant
  // is the number the desk just wrote down precisely because they are the one
  // who will be asked for the IP number at every counter for the rest of the
  // stay. Only one of the two is texted - both is two charges for one fact.
  await notifyAdmitted(input.attendantPhone?.trim() || result.patientPhone, {
    name: result.patientName,
    ipNumber: result.ipNumber,
    ward: result.ward,
    bedNo: result.bedNo,
  });

  return {
    admissionId: result.admissionId,
    ipNumber: result.ipNumber,
    bedNo: result.bedNo,
    ward: result.ward,
  };
}

/** Everyone currently in a bed, with the running charge so far. */
export async function currentInpatients(): Promise<{
  id: string; ipNumber: string; admittedAt: string; days: number;
  ward: string; bedNo: string; dailyCharge: string; runningCharge: string;
  bedCharge: string; extrasCharge: string; extras: number;
  reason: string | null; attendantName: string | null; attendantPhone: string | null;
  payerType: string; insurer: string | null; policyNo: string | null;
  doctor: { name: string; department: string };
  patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
}[]> {
  const rows = await prisma.admission.findMany({
    where: { status: "ADMITTED" },
    orderBy: { admittedAt: "asc" },
    select: {
      id: true, ipNumber: true, admittedAt: true, reason: true,
      attendantName: true, attendantPhone: true,
      payerType: true, insurer: true, policyNo: true,
      dailyChargeAtAdmit: true, wardNameAtAdmit: true,
      bed: { select: { bedNo: true } },
      charges: { select: { qty: true, unitPrice: true } },
      doctor: { select: { name: true, department: true } },
      patient: { select: { id: true, displayId: true, fullName: true, age: true, gender: true, phone: true } },
    },
  });

  const now = new Date();
  return rows.map((r: {
    id: string; ipNumber: string; admittedAt: Date; reason: string | null;
    attendantName: string | null; attendantPhone: string | null;
    payerType: string; insurer: string | null; policyNo: string | null;
    dailyChargeAtAdmit: { toString(): string }; wardNameAtAdmit: string;
    bed: { bedNo: string };
    charges: { qty: number; unitPrice: { toString(): string } }[];
    doctor: { name: string; department: string };
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
  }) => {
    const days = stayDays(r.admittedAt, now);
    const daily = Number(r.dailyChargeAtAdmit.toString());
    const bedCharge = days * daily;
    // The bed is not the bill. Procedures, oxygen and pharmacy all ride along.
    const extrasCharge = r.charges.reduce((s, c) => s + c.qty * Number(c.unitPrice.toString()), 0);
    return {
      id: r.id, ipNumber: r.ipNumber, admittedAt: r.admittedAt.toISOString(),
      days, ward: r.wardNameAtAdmit, bedNo: r.bed.bedNo,
      dailyCharge: daily.toFixed(2),
      bedCharge: bedCharge.toFixed(2),
      extrasCharge: extrasCharge.toFixed(2),
      extras: r.charges.length,
      runningCharge: (bedCharge + extrasCharge).toFixed(2),
      reason: r.reason, attendantName: r.attendantName, attendantPhone: r.attendantPhone,
      payerType: r.payerType, insurer: r.insurer, policyNo: r.policyNo,
      doctor: r.doctor, patient: r.patient,
    };
  });
}

/** Recently closed stays, each with its final IPD invoice - so the desk can
 *  re-print a bill after the patient has left and dropped off the live list.
 *
 *  Matches every closed status, not DISCHARGED alone. A stay that ended as LAMA or
 *  EXPIRED still produced a bill somebody may need to re-print, and filtering on
 *  DISCHARGED would have made those stays unreachable from the desk the moment
 *  they left the live list - the bill would exist with no screen that could find it. */
export async function recentDischarges(limit = 25): Promise<{
  id: string; ipNumber: string; admittedAt: string; dischargedAt: string; days: number;
  ward: string; bedNo: string; outcome: string;
  patient: { id: string; displayId: string; fullName: string };
  doctor: { name: string; department: string };
  invoice: { id: string; receiptNo: string; totalAmount: string; status: string } | null;
}[]> {
  const rows = await prisma.admission.findMany({
    where: { status: { in: CLOSED_STATUS_LIST } },
    orderBy: { dischargedAt: "desc" },
    take: limit,
    select: {
      id: true, ipNumber: true, admittedAt: true, dischargedAt: true, wardNameAtAdmit: true,
      status: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true } },
      doctor: { select: { name: true, department: true } },
      invoices: { where: { source: "IPD" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, receiptNo: true, totalAmount: true, status: true } },
    },
  });
  type Row = {
    id: string; ipNumber: string; admittedAt: Date; dischargedAt: Date | null; wardNameAtAdmit: string;
    status: string;
    bed: { bedNo: string } | null;
    patient: { id: string; displayId: string; fullName: string };
    doctor: { name: string; department: string };
    invoices: { id: string; receiptNo: string; totalAmount: { toString(): string }; status: string }[];
  };
  return (rows as Row[]).map((r) => {
    const end = r.dischargedAt ?? new Date();
    const inv = r.invoices[0];
    return {
      id: r.id, ipNumber: r.ipNumber,
      admittedAt: r.admittedAt.toISOString(), dischargedAt: end.toISOString(),
      days: stayDays(r.admittedAt, end),
      ward: r.wardNameAtAdmit, bedNo: r.bed?.bedNo ?? "-",
      // Carried through so the desk can see at a glance that a row in this list
      // was a death or an abscond rather than an ordinary discharge.
      outcome: r.status,
      patient: r.patient, doctor: r.doctor,
      invoice: inv ? { id: inv.id, receiptNo: inv.receiptNo, totalAmount: inv.totalAmount.toString(), status: inv.status } : null,
    };
  });
}

/**
 * Discharge: close the case, free the bed, and raise the IPD invoice for the
 * bed charges (days × rate-at-admission). Lab and pharmacy bills have already
 * accrued separately against the patient, exactly as they do for outpatients.
 */
type ChargeLine = {
  description: string; qty: number; category: string;
  unitPrice: { toString(): string }; gstRatePct: { toString(): string };
};

/**
 * Pharmacy and lab bills raised against a stay that are still unpaid.
 *
 * These are SEPARATE invoices, not room-tab charges - the pharmacy and the lab
 * each keep their own document. Which means the discharge desk is the only
 * place they can all be seen together, and the only chance to collect before
 * the patient walks out of the building.
 */
export async function outstandingForAdmission(admissionId: string): Promise<{
  bills: { id: string; receiptNo: string; source: string; total: string; paid: string; due: string; createdAt: string }[];
  totalDue: string;
}> {
  const rows = await prisma.invoice.findMany({
    where: {
      admissionId,
      // The IPD bill itself is raised BY the discharge - it is not an
      // outstanding prerequisite of it.
      source: { in: ["PHARMACY", "LAB", "OTHER"] },
      status: { not: "CANCELLED" },
      // ── NO PAYER FILTER ──
      //
      // This was `payer: "SELF_PAY"`. The reasoning was sound - a bill sitting
      // with an insurer is not money the family owes, and blocking every
      // cashless discharge on it would have turned the dues override into a
      // reflex. But it also hid the CO-PAY, so a family walked out owing a
      // share their insurer had explicitly refused.
      //
      // The filter is now per-rupee instead of per-bill: `due` below is the
      // patient's share alone, so the insurer's ₹1,80,000 still never blocks a
      // discharge while the family's ₹20,000 now does.
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, source: true, totalAmount: true, createdAt: true,
      insuranceCoveredAmount: true,
      payments: { select: { mode: true, amount: true } },
      refunds: { select: { amount: true } },
    },
  });

  type Row = {
    id: string; receiptNo: string; source: string; totalAmount: { toString(): string }; createdAt: Date;
    insuranceCoveredAmount: { toString(): string };
    payments: { mode: string; amount: { toString(): string } }[];
    refunds: { amount: { toString(): string } }[];
  };

  const bills = (rows as Row[]).map((i) => {
    // The patient's share. An insurer's part of this bill is not a debt the
    // discharge desk can collect and must never hold a family in the building.
    const split = splitInvoice({
      totalAmount: Number(i.totalAmount.toString()),
      insuranceCoveredAmount: Number(i.insuranceCoveredAmount.toString()),
      payments: i.payments.map((x) => ({ mode: String(x.mode), amount: Number(x.amount.toString()) })),
      refunds: i.refunds.map((x) => ({ amount: Number(x.amount.toString()) })),
    });
    return {
      id: i.id, receiptNo: i.receiptNo, source: i.source,
      total: split.total.toFixed(2), paid: split.patientPaid.toFixed(2),
      due: split.patientBalance.toFixed(2),
      createdAt: i.createdAt.toISOString(),
    };
  }).filter((b) => Number(b.due) > 0.01);

  return {
    bills,
    totalDue: bills.reduce((t, b) => round2(t + Number(b.due)), 0).toFixed(2),
  };
}

export async function dischargePatient(
  actor: AuthUser,
  input: {
    admissionId: string;
    discountAmount?: number;
    payment?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string };
    payments?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string }[];
    notes?: string;
    /** Discharge anyway, leaving pharmacy/lab bills unpaid. Audited. */
    allowOutstanding?: boolean;
    /**
     * How the stay ended. Defaults to DISCHARGED, so every existing caller keeps
     * its current behaviour and only a desk that deliberately picks an outcome
     * records anything else.
     */
    outcome?: DischargeOutcome;
  },
  ctx: { ipAddress?: string; userAgent?: string }
) {
  const outcome: DischargeOutcome = input.outcome ?? "DISCHARGED";

  // NOBODY LEAVES OWING THE PHARMACY OR THE LAB.
  //
  // Their bills are separate documents, so the IPD invoice below will not
  // include them and settling the stay would look complete while the medicines
  // were still unpaid. This is the last point at which the family is still in
  // the building.
  //
  // Refused rather than silently folded in: the desk has to decide - collect it,
  // or discharge on an explicit override that is recorded with a name against it.
  //
  // Whether this blocks at all is an admin setting. A hospital that settles dues
  // after the patient has gone can turn it off - but that has to be somebody's
  // decision, recorded in the audit log, not a default nobody chose.
  const { blockDischargeOnDues } = await getSettings();
  const outstanding = await outstandingForAdmission(input.admissionId);
  if (blockDischargeOnDues && outstanding.bills.length > 0 && !input.allowOutstanding) {
    const list = outstanding.bills
      .map((b) => `${b.source === "LAB" ? "Lab" : b.source === "PHARMACY" ? "Pharmacy" : "Other"} ${b.receiptNo} ₹${b.due}`)
      .join(", ");
    throw new ApiError(
      409,
      `₹${outstanding.totalDue} is still unpaid on this stay - ${list}. Collect it, or discharge with the override.`
    );
  }

  // Close the stay + free the bed atomically.
  const adm = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const a = await tx.admission.findUnique({
      where: { id: input.admissionId },
      select: {
        id: true, status: true, admittedAt: true, ipNumber: true, bedId: true,
        payerType: true, insurer: true,
        dailyChargeAtAdmit: true, wardNameAtAdmit: true, gstRatePctAtAdmit: true,
        charges: {
          orderBy: { createdAt: "asc" },
          select: { description: true, qty: true, unitPrice: true, gstRatePct: true, category: true },
        },
        patientId: true, patient: { select: { displayId: true, fullName: true, phone: true } },
        bed: { select: { bedNo: true } },
        // Whoever the desk recorded as the contact for this stay gets the
        // discharge text, same rule as the admission one.
        attendantPhone: true,
      },
    });
    if (!a) throw new ApiError(404, "Admission not found");
    // isClosed, not `=== "DISCHARGED"`. The old check let a stay already closed as
    // LAMA or EXPIRED be closed a second time as a discharge, which would have
    // overwritten a death with a discharge and billed the stay twice.
    if (isClosed(a.status)) {
      throw new ApiError(400, `This stay is already closed (${OUTCOME_LABEL[a.status as AdmissionStatusValue]})`);
    }

    const dischargedAt = new Date();
    await tx.admission.update({
      where: { id: a.id },
      data: { status: outcome, dischargedAt, dischargedById: actor.id },
    });

    // The closing note joins the same chronology as every ward entry rather than
    // being concatenated onto a blob. It carries the discharging user's name and
    // the moment the stay closed, which is exactly what a summary has to show.
    if (input.notes?.trim()) {
      await tx.admissionNote.create({
        data: {
          admissionId: a.id,
          body: input.notes.trim(),
          kind: "DISCHARGE",
          authorId: actor.id,
        },
      });
    }

    await tx.bed.update({ where: { id: a.bedId }, data: { status: "AVAILABLE" } });

    await logAudit(actor, {
      // The action names the outcome, so a medico-legal reader scanning the audit
      // log sees ADMISSION_CLOSED_EXPIRED and not a generic discharge that has to
      // be joined back to the Admission row to be understood.
      action: `ADMISSION_CLOSED_${outcome}`, targetTable: "Admission", targetId: a.id,
      meta: {
        outcome,
        ipNumber: a.ipNumber, bed: a.bed.bedNo,
        // If they left owing the pharmacy or the lab, that decision has a name
        // against it and an amount - months later, this is the only record of it.
        dischargedWithDues: outstanding.bills.length > 0 ? outstanding.totalDue : null,
        duesOverridden: outstanding.bills.length > 0 ? true : undefined,
      }, ...ctx,
    }, tx);

    return { ...a, dischargedAt };
  });

  // ── BED LINES - one per LEG of the stay ──
  //
  // A patient who moved General → ICU on day 3 did not spend the whole stay in
  // either. Billing one flat rate would rob one side or the other. So each
  // BedStay is priced on its own, at the rate that ward carried when they were
  // in it - a mid-stay price revision can never reach back and re-price days
  // already lived.
  const stays = await prisma.bedStay.findMany({
    where: { admissionId: adm.id },
    orderBy: { fromDate: "asc" },
    select: { wardName: true, dailyCharge: true, gstRatePct: true, fromDate: true, toDate: true, bed: { select: { bedNo: true } } },
  });

  type StayRow = {
    wardName: string; dailyCharge: { toString(): string }; gstRatePct: { toString(): string };
    fromDate: Date; toDate: Date | null; bed: { bedNo: string } | null;
  };

  const bedLines = (stays as StayRow[]).length > 0
    ? (stays as StayRow[]).map((st) => {
        const days = stayDays(st.fromDate, st.toDate ?? adm.dischargedAt);
        return {
          description: `Bed · ${st.wardName} · ${st.bed?.bedNo ?? "-"} · ${days} day${days > 1 ? "s" : ""}`,
          qty: days,
          unitPrice: Number(st.dailyCharge.toString()),
          gstRatePct: Number(st.gstRatePct.toString()),
        };
      })
    // Fallback for an admission created before BedStay existed and somehow not
    // backfilled. Never silently bill zero days for a bed someone slept in.
    : [{
        description: `Bed charges · ${adm.wardNameAtAdmit} · ${adm.bed.bedNo} · ${adm.ipNumber} · ${stayDays(adm.admittedAt, adm.dischargedAt)} day(s)`,
        qty: stayDays(adm.admittedAt, adm.dischargedAt),
        unitPrice: Number(adm.dailyChargeAtAdmit.toString()),
        gstRatePct: Number(adm.gstRatePctAtAdmit.toString()),
      }];

  const invoice = await createInvoice(
    actor,
    {
      patientId: adm.patientId,
      source: "IPD",
      admissionId: adm.id,
      // The final bill inherits the payer decided at admission. Nobody re-answers
      // the question at discharge, because by then the family is leaving and the
      // person who agreed the cashless arrangement went off shift days ago.
      payer: adm.payerType,
      payerName: adm.insurer ?? undefined,
      // The bed is only the first line (or lines - see above). Everything on the
      // running tab - procedures, oxygen, doctor rounds, lab tests, medicines sent
      // up from the pharmacy - is billed here, once, at discharge. Each line keeps
      // its own GST rate: a ₹5,500 room and a 12% syrup are not taxed the same way.
      lines: [
        ...bedLines,
        // Nursing care - assigned by default, billed at the same flat per-day rate
        // the running tab has been showing all along (days × NURSE_FEE_PER_DAY).
        {
          description: `Nursing care · ${stayDays(adm.admittedAt, adm.dischargedAt)} day(s) × ₹${NURSE_FEE_PER_DAY}`,
          qty: stayDays(adm.admittedAt, adm.dischargedAt),
          unitPrice: NURSE_FEE_PER_DAY,
          gstRatePct: 0,
        },
        ...(adm.charges as ChargeLine[]).map((c) => ({
          description: c.description,
          qty: c.qty,
          unitPrice: Number(c.unitPrice.toString()),
          gstRatePct: Number(c.gstRatePct.toString()),
        })),
      ],
      discountAmount: input.discountAmount,
      payment: input.payment,
      payments: input.payments,
      // The discharge text below carries this bill's balance already, and it is
      // sent AFTER the admission deposit has been applied a few lines down. A
      // bill SMS here would quote the balance before the advance came off it -
      // a larger number, sent first, about the same money.
      notify: false,
    },
    ctx
  );

  // ── ADVANCE ──
  // The deposit taken at admission is money the hospital ALREADY holds. Record it
  // against this invoice as a payment, so the family is asked only for the
  // balance.
  //
  // It is applied only up to what's still outstanding on the bill. A deposit
  // larger than the final bill must NOT be recorded in full: recordPayments
  // rejects any tender beyond the balance, so the whole call would throw and the
  // advance would silently fail to apply - leaving the bill showing the full
  // amount due against money the hospital was already holding. The excess stays
  // in AdmissionAdvance and surfaces as refundable on the discharge sheet.
  const advances = await prisma.admissionAdvance.findMany({
    where: { admissionId: adm.id },
    select: { amount: true, mode: true },
  });
  if (advances.length > 0) {
    const advTotal = (advances as { amount: { toString(): string }; mode: string }[])
      .reduce((sum, a) => sum + Number(a.amount.toString()), 0);
    const outstanding = Number(invoice.balanceDue);
    const toApply = Math.min(advTotal, outstanding);
    if (toApply > 0) {
      await recordPayment(
        actor,
        {
          invoiceId: invoice.id,
          mode: (advances as { mode: PaymentModeT }[])[0].mode,
          amount: toApply,
          reference: advancePaymentRef(adm.ipNumber),
        },
        ctx
      );
    }
  }

  // whole-stay length, for the receipt header (individual legs are on the bill)
  const days = stayDays(adm.admittedAt, adm.dischargedAt);
  // The bed is free again and the ward board must lose this row. Reception is
  // the screen that most needs it - a bed shown occupied is a bed not offered.
  // The insurance room hears this too: a discharge is what turns a pre-auth into
  // a final claim, and the bill it needs now exists.
  await publishLive(
    [TOPICS.IPD, TOPICS.RECEPTION, TOPICS.ADMIN, TOPICS.INSURANCE],
    EVENTS.ADMISSION_CLOSED
  );

  // RE-READ THE BILL, do not reuse `invoice` above. That copy was taken before
  // the admission deposit was applied to it, so its balanceDue is the figure
  // BEFORE the money the hospital already held came off - texting it would tell
  // a family they owe several thousand rupees they have already paid.
  const settled = await getInvoice(invoice.id).catch(() => null);

  // An EXPIRED stay is not texted "get well soon", and no automated message is
  // the right way for a family to hear anything about it. The outcome check is
  // the whole point: a death and a discharge are both "the stay closed" to the
  // billing code and are not remotely the same event to the person reading it.
  if (outcome !== "EXPIRED") {
    await notifyDischarged(adm.attendantPhone?.trim() || adm.patient.phone, {
      name: adm.patient.fullName,
      ipNumber: adm.ipNumber,
      days,
      balanceDue: settled ? settled.balanceDue : invoice.balanceDue,
    });
  }

  return { ipNumber: adm.ipNumber, days, invoice };
}

/** Small stat strip for the reception dashboard. */
export async function ipdStats(): Promise<{ admitted: number; availableBeds: number; totalBeds: number; dischargedToday: number }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const [admitted, availableBeds, totalBeds, dischargedToday] = await Promise.all([
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.bed.count({ where: { status: "AVAILABLE" } }),
    prisma.bed.count(),
    // Every closed status, not DISCHARGED alone. This number is how many beds
    // turned over today, and a bed freed by a death turned over exactly as much
    // as one freed by a discharge. Counting only discharges would have made the
    // dashboard disagree with the ward board on the days it mattered most.
    prisma.admission.count({
      where: { status: { in: CLOSED_STATUS_LIST }, dischargedAt: { gte: today, lt: tomorrow } },
    }),
  ]);
  return { admitted, availableBeds, totalBeds, dischargedToday };
}

/**
 * One-click ward setup for a hospital starting from nothing.
 *
 * Idempotent (upsert by ward name, upsert by ward+bed number), so it is safe to
 * press twice and safe to run against a half-configured hospital. Same shape as
 * the seed - this exists so go-live doesn't require a developer at a terminal.
 *
 * GST: room rent over ₹5,000/day (non-ICU) attracts 5%; below that it is exempt,
 * and ICU is exempt regardless. Only Private (₹5,500) carries a rate here. The
 * client's CA has the final say - admin can edit every rate afterwards.
 */
export async function setupStandardWards(
  actor: AuthUser,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ wards: number; beds: number }> {
  const PLAN = [
    { name: "General Ward", category: "GENERAL",      floor: "1st Floor", dailyCharge: 1500, gstRatePct: 0, beds: 10, prefix: "GW" },
    { name: "Semi-Private", category: "SEMI_PRIVATE", floor: "2nd Floor", dailyCharge: 3000, gstRatePct: 0, beds: 6,  prefix: "SP" },
    { name: "Private Room", category: "PRIVATE",      floor: "2nd Floor", dailyCharge: 5500, gstRatePct: 5, beds: 4,  prefix: "PR" },
    { name: "ICU",          category: "ICU",          floor: "3rd Floor", dailyCharge: 8000, gstRatePct: 0, beds: 4,  prefix: "ICU" },
  ];

  let bedCount = 0;
  for (const w of PLAN) {
    const ward = await prisma.ward.upsert({
      where: { name: w.name },
      update: {},
      create: {
        name: w.name, category: w.category, floor: w.floor,
        dailyCharge: w.dailyCharge.toFixed(2), gstRatePct: w.gstRatePct.toFixed(2), active: true,
      },
      select: { id: true },
    });
    for (let i = 1; i <= w.beds; i++) {
      const bedNo = `${w.prefix}-${String(i).padStart(2, "0")}`;
      await prisma.bed.upsert({
        where: { wardId_bedNo: { wardId: ward.id, bedNo } },
        update: {},
        create: { wardId: ward.id, bedNo, status: "AVAILABLE" },
      });
      bedCount++;
    }
  }

  await logAudit(actor, {
    action: "WARDS_STANDARD_SETUP", targetTable: "Ward", targetId: "bulk",
    meta: { wards: PLAN.length, beds: bedCount }, ...ctx,
  });
  return { wards: PLAN.length, beds: bedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RUNNING TAB
// A stay is not just a bed. It's the bed PLUS everything done in it. Every
// procedure, oxygen hour, doctor's round and strip of medicine goes on this
// ledger, and the whole thing is billed once at discharge.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChargeDTO {
  id: string; category: string; description: string;
  qty: number; unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}

/** Add a line to an inpatient's tab. */
export async function addAdmissionCharge(
  actor: AuthUser,
  input: {
    admissionId: string; category: string; description: string;
    qty: number; unitPrice: number; gstRatePct?: number;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const adm = await prisma.admission.findUnique({
    where: { id: input.admissionId },
    select: { id: true, status: true, ipNumber: true },
  });
  if (!adm) throw new ApiError(404, "Admission not found");
  if (adm.status !== "ADMITTED") {
    throw new ApiError(409, "This patient is already discharged - their bill is closed");
  }
  if (input.qty < 1) throw new ApiError(400, "Quantity must be at least 1");
  if (input.unitPrice < 0) throw new ApiError(400, "Price can't be negative");

  await prisma.admissionCharge.create({
    data: {
      admissionId: input.admissionId,
      // validated upstream against the ChargeCategory values; narrow for Prisma
      category: input.category as ChargeCategory,
      description: input.description.trim(),
      qty: input.qty,
      unitPrice: input.unitPrice.toFixed(2),
      gstRatePct: (input.gstRatePct ?? 0).toFixed(2),
      addedById: actor.id,
    },
  });
  await logAudit(actor, {
    action: "IPD_CHARGE_ADDED", targetTable: "Admission", targetId: input.admissionId,
    meta: { ipNumber: adm.ipNumber, description: input.description, amount: input.qty * input.unitPrice },
    ...ctx,
  });
}

/**
 * REPRICE OR CORRECT A LINE. Only while the patient is still in.
 *
 * Exists because the same treatment is not the same money to every payer. An
 * insurer or scheme settles against ITS OWN tariff - CGHS pays one rate for a
 * dressing, Star Health another, the counter price is a third - and the desk
 * preparing a claim has to make the bill say what that policy will actually
 * honour. Until this existed the only way to do that was delete the line and
 * add it back, which threw away who first raised the charge and when, on the
 * one document most likely to be argued over months later.
 *
 * Editing writes a NOTE onto the stay rather than mutating quietly: the old
 * figure and the new one both survive, because "the bill was changed after the
 * treatment" is exactly the question an insurer asks.
 *
 * A pharmacy-sourced line is refused, for the same reason it cannot be deleted:
 * it represents stock that physically left a shelf at a price the pharmacy
 * recorded, and re-pricing it here would silently decouple the bill from the
 * dispense.
 */
export async function updateAdmissionCharge(
  actor: AuthUser,
  chargeId: string,
  input: { description?: string; qty?: number; unitPrice?: number; gstRatePct?: number; category?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const charge = await prisma.admissionCharge.findUnique({
    where: { id: chargeId },
    select: {
      id: true, sourceRef: true, description: true, qty: true, unitPrice: true, gstRatePct: true,
      admission: { select: { id: true, status: true, ipNumber: true } },
    },
  });
  if (!charge) throw new ApiError(404, "Charge not found");
  if (charge.admission.status !== "ADMITTED") {
    throw new ApiError(409, "That stay is already billed - its charges can't be changed");
  }
  if (charge.sourceRef) {
    throw new ApiError(400, "This came from a pharmacy dispense. Change it in the pharmacy, not here.");
  }
  if (input.qty !== undefined && input.qty < 1) throw new ApiError(400, "Quantity must be at least 1");
  if (input.unitPrice !== undefined && input.unitPrice < 0) throw new ApiError(400, "Price can't be negative");

  const before = {
    description: charge.description,
    qty: charge.qty,
    unitPrice: Number(charge.unitPrice.toString()),
    gstRatePct: Number(charge.gstRatePct.toString()),
  };
  const after = {
    description: input.description?.trim() || before.description,
    qty: input.qty ?? before.qty,
    unitPrice: input.unitPrice ?? before.unitPrice,
    gstRatePct: input.gstRatePct ?? before.gstRatePct,
  };

  // Nothing actually moved - don't write a note claiming somebody changed the
  // bill. A ward record full of "changed X to X" is a record nobody reads.
  const changed =
    before.description !== after.description || before.qty !== after.qty ||
    before.unitPrice !== after.unitPrice || before.gstRatePct !== after.gstRatePct ||
    (input.category !== undefined && input.category !== null);
  if (!changed) return;

  await prisma.$transaction(async (tx) => {
    await tx.admissionCharge.update({
      where: { id: chargeId },
      data: {
        ...(input.category ? { category: input.category as ChargeCategory } : {}),
        description: after.description,
        qty: after.qty,
        unitPrice: after.unitPrice.toFixed(2),
        gstRatePct: after.gstRatePct.toFixed(2),
      },
    });
    await tx.admissionNote.create({
      data: {
        admissionId: charge.admission.id,
        kind: "NURSING",
        body:
          `Bill line repriced: "${before.description}" ${before.qty} × ₹${before.unitPrice.toFixed(2)}` +
          ` → "${after.description}" ${after.qty} × ₹${after.unitPrice.toFixed(2)}`,
        authorId: actor.id,
      },
    });
  });

  await logAudit(actor, {
    action: "IPD_CHARGE_UPDATED", targetTable: "Admission", targetId: charge.admission.id,
    meta: { ipNumber: charge.admission.ipNumber, chargeId, before, after }, ...ctx,
  });
}

/** Remove a line that was added by mistake. Only while the patient is still in. */
export async function removeAdmissionCharge(
  actor: AuthUser,
  chargeId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const charge = await prisma.admissionCharge.findUnique({
    where: { id: chargeId },
    select: { id: true, sourceRef: true, admission: { select: { id: true, status: true, ipNumber: true } } },
  });
  if (!charge) throw new ApiError(404, "Charge not found");
  if (charge.admission.status !== "ADMITTED") {
    throw new ApiError(409, "That stay is already billed - the charge can't be removed");
  }
  if (charge.sourceRef) {
    // Deleting it here would silently un-bill medicine that physically left the shelf.
    throw new ApiError(400, "This came from a pharmacy dispense. Reverse it in the pharmacy, not here.");
  }
  await prisma.admissionCharge.delete({ where: { id: chargeId } });
  await logAudit(actor, {
    action: "IPD_CHARGE_REMOVED", targetTable: "Admission", targetId: charge.admission.id,
    meta: { ipNumber: charge.admission.ipNumber, chargeId }, ...ctx,
  });
}

/**
 * Nursing / observation notes for the stay - shift-handover text, not billed.
 *
 * APPEND-ONLY. There is deliberately no update and no delete here, and adding
 * one would undo the point of the table: the previous shape was a single
 * mutable string, so the evening shift's entry silently destroyed the morning's
 * and neither carried an author or a time. A ward record that can be quietly
 * rewritten is worth very little the day somebody questions the stay.
 *
 * A correction is a NEW entry saying what it corrects - the same thing you do
 * on paper, and the only version that survives being challenged.
 */
export interface AdmissionNoteDTO {
  id: string;
  body: string;
  kind: "NURSING" | "DISCHARGE";
  /** Null only on entries migrated from the old column - never a guess. */
  authorName: string | null;
  createdAt: string;
}

const noteSelect = {
  id: true, body: true, kind: true, createdAt: true,
  author: { select: { name: true } },
} as const;

type NoteRow = {
  id: string; body: string; kind: string; createdAt: Date;
  author: { name: string } | null;
};

function toNoteDTO(n: NoteRow): AdmissionNoteDTO {
  return {
    id: n.id,
    body: n.body,
    kind: n.kind as "NURSING" | "DISCHARGE",
    authorName: n.author?.name ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Every entry against a stay, oldest first - it reads as a chronology. */
export async function listAdmissionNotes(admissionId: string): Promise<AdmissionNoteDTO[]> {
  const rows = await prisma.admissionNote.findMany({
    where: { admissionId },
    orderBy: { createdAt: "asc" },
    select: noteSelect,
  });
  return (rows as NoteRow[]).map(toNoteDTO);
}

/** Add one entry. The only write path - see the note above about corrections. */
export async function addAdmissionNote(
  actor: AuthUser,
  admissionId: string,
  body: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<AdmissionNoteDTO> {
  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: { id: true, status: true, ipNumber: true },
  });
  if (!adm) throw new ApiError(404, "Admission not found");
  if (adm.status !== "ADMITTED") throw new ApiError(409, "This stay is closed - its notes are final");

  const clean = body.trim();
  if (!clean) throw new ApiError(400, "Write something before saving the note");

  const row = await prisma.admissionNote.create({
    data: { admissionId, body: clean, kind: "NURSING", authorId: actor.id },
    select: noteSelect,
  });

  await logAudit(actor, {
    action: "IPD_NOTE_ADDED", targetTable: "AdmissionNote", targetId: row.id,
    meta: { ipNumber: adm.ipNumber, admissionId }, ...ctx,
  });

  return toNoteDTO(row as NoteRow);
}

/**
 * The patient's full record surfaced on the IPD sheet, the way the patient
 * profile shows it: billings, lab reports and prescriptions / pharmacy history.
 * Scoped by the admission's patient; the current stay's rows are flagged.
 */
export async function admissionHistory(admissionId: string): Promise<{
  bills: { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string; payer: string }[];
  labs: { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; forThisStay: boolean }[];
  prescriptions: { id: string; title: string | null; fileUrl: string | null; status: string; forThisStay: boolean; date: string; items: { medicineName: string; qty: number; dosage: string | null }[] }[];
}> {
  const adm = await prisma.admission.findUnique({ where: { id: admissionId }, select: { patientId: true } });
  if (!adm) throw new ApiError(404, "Admission not found");
  const patientId = adm.patientId;

  const [invoices, labs, rxs] = await Promise.all([
    prisma.invoice.findMany({
      where: { patientId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, receiptNo: true, source: true, status: true, totalAmount: true, createdAt: true, payer: true, payments: { select: { amount: true } } },
    }),
    prisma.labTest.findMany({
      where: { patientId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, testName: true, status: true, reportFileUrl: true, createdAt: true, completedAt: true, admissionId: true },
    }),
    prisma.prescriptionUpload.findMany({
      where: { patientId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, title: true, fileUrl: true, status: true, admissionId: true, createdAt: true, items: { select: { medicineName: true, qty: true, dosage: true }, orderBy: { id: "asc" } } },
    }),
  ]);

  type Inv = { id: string; receiptNo: string; source: string; status: string; totalAmount: { toString(): string }; createdAt: Date; payer: string; payments: { amount: { toString(): string } }[] };
  type Lab = { id: string; testName: string; status: string; reportFileUrl: string | null; createdAt: Date; completedAt: Date | null; admissionId: string | null };
  type Rx = { id: string; title: string | null; fileUrl: string | null; status: string; admissionId: string | null; createdAt: Date; items: { medicineName: string; qty: number; dosage: string | null }[] };

  return {
    bills: (invoices as Inv[]).map((i) => {
      const total = Number(i.totalAmount.toString());
      const paid = i.payments.reduce((s, p) => s + Number(p.amount.toString()), 0);
      return { id: i.id, receiptNo: i.receiptNo, source: i.source, status: i.status, total: total.toFixed(2), paid: paid.toFixed(2), balance: Math.max(0, total - paid).toFixed(2), date: i.createdAt.toISOString().slice(0, 10), payer: i.payer };
    }),
    labs: (labs as Lab[]).map((t) => ({ id: t.id, testName: t.testName, status: t.status, reportReady: Boolean(t.reportFileUrl), reportUrl: t.reportFileUrl, date: (t.completedAt ?? t.createdAt).toISOString().slice(0, 10), forThisStay: t.admissionId === admissionId })),
    prescriptions: (rxs as Rx[]).map((r) => ({ id: r.id, title: r.title, fileUrl: r.fileUrl, status: r.status, forThisStay: r.admissionId === admissionId, date: r.createdAt.toISOString().slice(0, 10), items: r.items })),
  };
}

/**
 * Everything a discharge summary needs, assembled from what the stay already
 * holds - nothing is typed twice. Reason and observation notes come off the
 * admission; diagnosis / advice / follow-up and the medicine list come off the
 * IP prescriptions filed during the stay; investigations are the lab tests run
 * in the admission window; and the bill is the same running sheet, frozen.
 */
export async function dischargeSummaryData(admissionId: string) {
  const sheet = await admissionSheet(admissionId);

  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: {
      ipNumber: true, status: true, admittedAt: true, dischargedAt: true, reason: true,
      // WHO SETTLES THIS STAY. Printed on the summary as its own field, the way
      // the hospital's own paper does it ("H.Pannel : INSURANCE"). A reader
      // picking up a discharge summary needs to know whether it belongs with a
      // claim file or with a counter receipt, and the two go to different desks.
      payerType: true, insurer: true, policyNo: true,
      patient: {
        select: {
          displayId: true, fullName: true, age: true, gender: true, phone: true,
          address: true, city: true, bloodGroup: true, dob: true,
        },
      },
      doctor: { select: { name: true, specialization: true, department: true } },
      prescriptionUploads: {
        orderBy: { createdAt: "asc" },
        select: {
          diagnosis: true, advice: true, nextVisit: true,
          advisedLabs: { select: { testName: true, labTestId: true, declinedAt: true }, orderBy: { createdAt: "asc" } },
          items: { select: { medicineName: true, qty: true, dosage: true }, orderBy: { id: "asc" } },
        },
      },
    },
  });
  if (!adm) throw new ApiError(404, "Admission not found");

  const hospital = await prisma.hospitalConfig.findFirst();

  // THE DISCOUNT LIVES ON THE INVOICE, NOT ON THE RUNNING TAB.
  //
  // `admissionSheet` is what the stay has COST so far. A discount is agreed at
  // the counter when the bill is raised, so it exists only on the IPD invoice -
  // which is why this summary printed a grand total the family had never been
  // asked for, with no line explaining the difference.
  //
  // Read here rather than recomputed: the invoice IS the tax document, and a
  // summary that disagrees with it by a rupee is the one brought back to the desk.
  const ipdInvoice = await prisma.invoice.findFirst({
    where: { admissionId, source: "IPD", status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    select: {
      receiptNo: true, subtotal: true, discountAmount: true, taxableAmount: true,
      cgstAmount: true, sgstAmount: true, totalAmount: true,
      payments: { select: { amount: true } },
      refunds: { select: { amount: true } },
    },
  });

  // Lab tests ordered while the patient was in - the stay's investigations.
  const until = adm.dischargedAt ?? new Date();
  const labs = await prisma.labTest.findMany({
    where: { patientId: sheet.admission.patient.id, createdAt: { gte: adm.admittedAt, lte: until } },
    orderBy: { createdAt: "asc" },
    select: { testName: true, status: true, reportFileUrl: true, createdAt: true },
  });

  // ── Clinical narrative, derived (never typed twice) ──
  type AdvisedRow = { testName: string; labTestId: string | null; declinedAt: Date | null };
  type Rx = {
    diagnosis: string | null; advice: string | null; nextVisit: string | null;
    advisedLabs: AdvisedRow[];
    items: { medicineName: string; qty: number; dosage: string | null }[];
  };
  const rxs = adm.prescriptionUploads as Rx[];
  const firstOf = (pick: (r: Rx) => string | null) => rxs.map(pick).map((v) => v?.trim()).filter(Boolean) as string[];
  const diagnosis = firstOf((r) => r.diagnosis)[0] ?? null;
  const advice = [...new Set(firstOf((r) => r.advice))].join(" ") || null;
  const nextVisit = firstOf((r) => r.nextVisit).slice(-1)[0] ?? null;

  // Advised tests now carry whether they were actually ordered. The summary says
  // so: a test the doctor asked for that never happened is precisely the thing a
  // reader of this document needs to see, and the old free-text version could
  // not distinguish it from one that was done. mergeAdvice collapses the same
  // test advised on several days of the stay into one honest line.
  const labsAdvised = mergeAdvice(rxs.flatMap((r) => r.advisedLabs));

  // Medicines on discharge - one row per drug, dosage from its latest mention.
  const medMap = new Map<string, { name: string; qty: number; dosage: string | null }>();
  for (const r of rxs) {
    for (const it of r.items) {
      const key = it.medicineName.trim().toLowerCase();
      if (!key) continue;
      const prev = medMap.get(key);
      medMap.set(key, { name: it.medicineName.trim(), qty: (prev?.qty ?? 0) + it.qty, dosage: it.dosage?.trim() || prev?.dosage || null });
    }
  }

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    hospital,
    generatedAt: new Date().toISOString(),
    admission: {
      ipNumber: adm.ipNumber,
      status: adm.status,
      admittedAt: adm.admittedAt.toISOString(),
      dischargedAt: iso(adm.dischargedAt),
      days: sheet.days,
      wardName: sheet.admission.wardName,
      bedNo: sheet.admission.bedNo,
      reason: adm.reason,
      /** The full chronology, each entry with its author and time. */
      observations: sheet.notes,
      /** SELF_PAY or INSURANCE - the summary's "H.Pannel" line. */
      payerType: adm.payerType,
      insurer: adm.insurer,
      policyNo: adm.policyNo,
    },
    patient: {
      displayId: adm.patient.displayId, fullName: adm.patient.fullName, age: adm.patient.age,
      gender: adm.patient.gender, phone: adm.patient.phone, address: adm.patient.address,
      city: adm.patient.city, bloodGroup: adm.patient.bloodGroup,
      dob: adm.patient.dob ? adm.patient.dob.toISOString().slice(0, 10) : null,
    },
    doctor: adm.doctor,
    clinical: { diagnosis, advice, nextVisit, labsAdvised },
    medicines: [...medMap.values()],
    investigations: labs.map((l) => ({
      testName: l.testName, status: l.status, reportReady: Boolean(l.reportFileUrl),
      date: l.createdAt.toISOString().slice(0, 10),
    })),
    // The frozen bill - the running sheet's lines, plus the raised invoice's own
    // totals where one exists. Both are shown because they answer different
    // questions: the lines say what the stay was made of, the invoice says what
    // was actually charged once a discount was agreed.
    bill: {
      legs: sheet.legs, bedTotal: sheet.bedTotal, nurseTotal: sheet.nurseTotal, nursePerDay: sheet.nursePerDay,
      charges: sheet.charges, chargesTotal: sheet.chargesTotal,
      grandTotal: sheet.grandTotal, advanceTotal: sheet.advanceTotal, balance: sheet.balance,
      /** The IPD invoice, once a discharge has raised one. Null while the
       *  patient is still in a bed: there is no discount to show before there
       *  is a bill to discount. */
      invoice: ipdInvoice ? (() => {
        const paid = round2(
          ipdInvoice.payments.reduce((t, x) => t + Number(x.amount), 0) -
          ipdInvoice.refunds.reduce((t, x) => t + Number(x.amount), 0)
        );
        const total = Number(ipdInvoice.totalAmount);
        return {
          receiptNo: ipdInvoice.receiptNo,
          subtotal: Number(ipdInvoice.subtotal).toFixed(2),
          discount: Number(ipdInvoice.discountAmount).toFixed(2),
          taxable: Number(ipdInvoice.taxableAmount).toFixed(2),
          gst: (Number(ipdInvoice.cgstAmount) + Number(ipdInvoice.sgstAmount)).toFixed(2),
          total: total.toFixed(2),
          paid: paid.toFixed(2),
          balance: Math.max(0, round2(total - paid)).toFixed(2),
        };
      })() : null,
    },
  };
}

/**
 * Nursing care is assigned to every admitted patient by default and accrues at a
 * flat rate per day - like the bed, it grows with the length of stay and is
 * derived (not a stored charge line) so it can never go stale or be half-removed.
 *
 * ₹600 is the hospital's published rate ("Nursing charges … 600/-" on the
 * inpatient board at Balasamudram). It sat at ₹200 here, which is not a rate
 * this hospital has ever charged - so every inpatient bill since the ward
 * opened under-billed nursing by ₹400 a day, quietly, on the one line nobody
 * checks because the software supplied it.
 *
 * Applied everywhere at once, because it is read in one place: the running tab
 * the ward sees, the discharge invoice, and the claim bill the insurer settles
 * all take this constant. Bills already RAISED are untouched - an invoice is a
 * tax document and is never rewritten by a rate change.
 */
export const NURSE_FEE_PER_DAY = 600;

/** The full running tab: bed so far + every charge, with a live total. */
export async function admissionSheet(admissionId: string): Promise<{
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    /** Who settles this stay, decided at admission. Drives the banner the ward
     *  and the discharge desk read before they ask anyone for money. */
    payerType: string; insurer: string | null; policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number;
  bedTotal: string;
  /** Assigned nursing care, days × NURSE_FEE_PER_DAY. Derived, not a stored line. */
  nurseTotal: string;
  nursePerDay: string;
  /** The stay's chronology, oldest first. Append-only - see AdmissionNote. */
  notes: AdmissionNoteDTO[];
  charges: ChargeDTO[];
  chargesTotal: string;
  grandTotal: string;
  /** One row per bed occupied. Two rows means they were transferred. */
  legs: { wardName: string; bedNo: string; dailyCharge: string; days: number; total: string; current: boolean }[];
  /** Deposit already held. Comes off the discharge bill. */
  advanceTotal: string;
  /** Each deposit slip, so a lost receipt can be reprinted from the stay. */
  advances: { id: string; receiptNo: string | null; amount: string; mode: string; takenAt: string }[];
  /** Pharmacy and lab bills raised against this stay that are still unpaid.
   *  They are separate documents, so this running sheet is the only place
   *  the ward sees them together - and the reminder that stops a discharge
   *  leaving money uncollected. */
  outstandingBills: { id: string; receiptNo: string; source: string; total: string; paid: string; due: string; createdAt: string }[];
  outstandingTotal: string;
  /**
   * PHARMACY AND LAB ON A CASHLESS STAY - counted, not chased.
   *
   * A self-paying family settles three bills at three counters, and those show
   * up in `outstandingBills` above as money somebody has to collect. A cashless
   * patient pays at no counter at all: the pharmacy dispenses to the ward, the
   * lab runs the samples, and every rupee of it belongs on one claim.
   *
   * So on an insurance stay those bills move out of "go and collect this" and
   * into the running total instead - which is the only way the ward and the
   * desk can see what the stay has actually cost. They were invisible before:
   * excluded from the dues list because nobody owes them, and absent from the
   * total because they are separate invoices.
   *
   * Empty on a self-paying stay, where the separate-counter flow is unchanged.
   */
  claimBills: { id: string; receiptNo: string; source: string; total: string; createdAt: string }[];
  claimBillsTotal: string;
  /**
   * grandTotal + claimBillsTotal - everything the insurer is being asked for.
   * Equals grandTotal on a self-paying stay, so any screen can show this figure
   * without first working out which kind of stay it is looking at.
   */
  claimTotal: string;
  /** grandTotal − advanceTotal, floored at 0. What the family still owes today. */
  balance: string;
}> {
  const a = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true, reason: true,
      noteEntries: { orderBy: { createdAt: "asc" }, select: noteSelect },
      wardNameAtAdmit: true, dailyChargeAtAdmit: true, gstRatePctAtAdmit: true,
      attendantName: true, attendantPhone: true, attendantRelation: true,
      payerType: true, insurer: true, policyNo: true, memberId: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true, age: true, gender: true, phone: true } },
      doctor: { select: { name: true, department: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, category: true, description: true, qty: true, unitPrice: true,
          gstRatePct: true, sourceRef: true, createdAt: true,
          addedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!a) throw new ApiError(404, "Admission not found");

  type ChargeRow = {
    id: string; category: string; description: string; qty: number;
    unitPrice: { toString(): string }; gstRatePct: { toString(): string };
    sourceRef: string | null; createdAt: Date; addedBy: { name: string };
  };

  const days = stayDays(a.admittedAt, a.dischargedAt ?? new Date());
  // ── BED, PER LEG ──
  // A transferred patient did not spend the whole stay in one ward. Sum each leg
  // at the rate it actually carried, or the running bill on screen won't match
  // the invoice they get at discharge.
  const stays = await prisma.bedStay.findMany({
    where: { admissionId },
    orderBy: { fromDate: "asc" },
    select: {
      wardName: true, dailyCharge: true, fromDate: true, toDate: true,
      bed: { select: { bedNo: true } },
    },
  });

  type StayRow = {
    wardName: string; dailyCharge: { toString(): string };
    fromDate: Date; toDate: Date | null; bed: { bedNo: string } | null;
  };

  const until = a.dischargedAt ?? new Date();
  const legs = (stays as StayRow[]).map((st) => {
    const d = stayDays(st.fromDate, st.toDate ?? until);
    const daily = Number(st.dailyCharge.toString());
    return {
      wardName: st.wardName,
      bedNo: st.bed?.bedNo ?? "-",
      dailyCharge: daily.toFixed(2),
      days: d,
      total: (d * daily).toFixed(2),
      current: st.toDate === null,
    };
  });

  // Fall back to the flat rate only if no BedStay exists (pre-migration rows).
  const bedTotal = legs.length > 0
    ? legs.reduce((sum, l) => sum + Number(l.total), 0)
    : days * Number(a.dailyChargeAtAdmit.toString());

  // ── ADVANCE ── money the hospital is already holding for this stay.
  const advanceRows = await prisma.admissionAdvance.findMany({
    where: { admissionId },
    orderBy: { createdAt: "asc" },
    select: { id: true, receiptNo: true, amount: true, mode: true, createdAt: true },
  });
  type AdvRow = { id: string; receiptNo: string | null; amount: { toString(): string }; mode: string; createdAt: Date };
  const advances = (advanceRows as AdvRow[]).map((x) => ({
    id: x.id, receiptNo: x.receiptNo, amount: x.amount.toString(), mode: x.mode,
    takenAt: x.createdAt.toISOString(),
  }));
  const advanceTotal = advances.reduce((sum, x) => sum + Number(x.amount), 0);

  // What the pharmacy and the lab are still owed for this stay.
  const outstanding = await outstandingForAdmission(admissionId);

  const charges: ChargeDTO[] = (a.charges as ChargeRow[]).map((c) => {
    const amount = c.qty * Number(c.unitPrice.toString());
    return {
      id: c.id, category: c.category, description: c.description, qty: c.qty,
      unitPrice: c.unitPrice.toString(), gstRatePct: c.gstRatePct.toString(),
      amount: amount.toFixed(2),
      addedBy: c.addedBy.name,
      createdAt: c.createdAt.toISOString(),
      fromPharmacy: Boolean(c.sourceRef),
    };
  });
  const chargesTotal = charges.reduce((s, c) => s + Number(c.amount), 0);

  // ── NURSING ── assigned by default, one flat fee per day of stay.
  const nurseTotal = days * NURSE_FEE_PER_DAY;
  const grandTotal = bedTotal + nurseTotal + chargesTotal;

  // ── WHAT THE CLAIM CARRIES BEYOND THE STAY ──
  //
  // Only on a cashless admission, and only bills actually going to the insurer.
  // See the claimBills doc on the return type for why these belong in a total
  // rather than in a list of things to chase.
  //
  // grandTotal is deliberately NOT changed. It is the figure the discharge
  // screen quotes and the IPD invoice is raised from, and that invoice covers
  // the stay alone - pharmacy and lab already have invoices of their own.
  // Folding these into grandTotal would have the desk collect for medicines
  // twice, once here and once on the pharmacy's own bill.
  const claimInvoices = a.payerType === "INSURANCE"
    ? await prisma.invoice.findMany({
        where: {
          admissionId,
          source: { in: ["PHARMACY", "LAB", "OTHER"] },
          status: { not: "CANCELLED" },
          payer: "INSURANCE",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, receiptNo: true, source: true, totalAmount: true, createdAt: true },
      })
    : [];
  const claimBills = claimInvoices.map((i) => ({
    id: i.id, receiptNo: i.receiptNo, source: i.source,
    total: Number(i.totalAmount).toFixed(2),
    createdAt: i.createdAt.toISOString(),
  }));
  const claimBillsTotal = claimBills.reduce((s, b) => round2(s + Number(b.total)), 0);

  return {
    admission: {
      id: a.id, ipNumber: a.ipNumber, status: a.status,
      admittedAt: a.admittedAt.toISOString(), reason: a.reason,
      wardName: a.wardNameAtAdmit, bedNo: a.bed.bedNo,
      dailyCharge: a.dailyChargeAtAdmit.toString(), gstRatePct: a.gstRatePctAtAdmit.toString(),
      attendantName: a.attendantName, attendantPhone: a.attendantPhone, attendantRelation: a.attendantRelation,
      payerType: a.payerType, insurer: a.insurer, policyNo: a.policyNo, memberId: a.memberId,
      patient: a.patient, doctor: a.doctor,
    },
    days,
    bedTotal: bedTotal.toFixed(2),
    nurseTotal: nurseTotal.toFixed(2),
    nursePerDay: NURSE_FEE_PER_DAY.toFixed(2),
    notes: (a.noteEntries as NoteRow[]).map(toNoteDTO),
    chargesTotal: chargesTotal.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    charges,
    legs,
    advanceTotal: advanceTotal.toFixed(2),
    advances,
    outstandingBills: outstanding.bills,
    outstandingTotal: outstanding.totalDue,
    claimBills,
    claimBillsTotal: claimBillsTotal.toFixed(2),
    claimTotal: round2(grandTotal + claimBillsTotal).toFixed(2),
    // Never negative. An advance bigger than the bill is a REFUND owed, not a
    // negative debt that would quietly subtract from the day's takings.
    balance: Math.max(0, grandTotal - advanceTotal).toFixed(2),
  };
}

// chargePharmacyToRoom() lived here. It folded an inpatient's medicine into the
// discharge bill as AdmissionCharge rows. That is no longer how this works:
// pharmacy raises its OWN invoice against the admission (pharmacy.service.ts),
// labs raise theirs (labs.service.ts), and the IPD bill covers only bed, nursing
// and ward charges. Re-adding a path that writes category: "PHARMACY" charges
// would double-bill the patient - the medicine invoice already exists.

/** Beds that can actually be filled right now, grouped by ward - for the admit form. */
export async function availableBeds(): Promise<{
  id: string; name: string; category: string; floor: string | null;
  dailyCharge: string; gstRatePct: string;
  beds: { id: string; bedNo: string }[];
}[]> {
  const wards = await prisma.ward.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, category: true, floor: true, dailyCharge: true, gstRatePct: true,
      beds: {
        where: { status: "AVAILABLE" },
        orderBy: { bedNo: "asc" },
        select: { id: true, bedNo: true },
      },
    },
  });
  type W = {
    id: string; name: string; category: string; floor: string | null;
    dailyCharge: { toString(): string }; gstRatePct: { toString(): string };
    beds: { id: string; bedNo: string }[];
  };
  return (wards as W[]).map((w) => ({
    id: w.id, name: w.name, category: w.category, floor: w.floor,
    dailyCharge: w.dailyCharge.toString(), gstRatePct: w.gstRatePct.toString(),
    beds: w.beds,
  }));
}

/**
 * Is this patient in a bed RIGHT NOW?
 *
 * The single question the whole IP/OP switch turns on. Reception asks it the
 * moment a patient is picked, and everything downstream - where a prescription
 * files, where a lab test bills - follows from the answer. Returns null for an
 * outpatient, which is the overwhelmingly common case.
 */
export async function activeAdmissionFor(patientRef: string): Promise<{
  id: string; ipNumber: string; admittedAt: Date;
  wardName: string; bedNo: string;
  doctorName: string; reason: string | null;
} | null> {
  // Callers hold different handles on the same person: the search box has a UHID
  // (JMH2026OP00001), the inpatient picker has the internal id. Resolve either
  // rather than pushing that distinction onto the frontend.
  const patient = await prisma.patient.findFirst({
    where: { OR: [{ id: patientRef }, { displayId: patientRef.toUpperCase() }] },
    select: { id: true },
  });
  if (!patient) return null;

  const adm = await prisma.admission.findFirst({
    where: { patientId: patient.id, status: "ADMITTED" },
    orderBy: { admittedAt: "desc" },
    select: {
      id: true, ipNumber: true, admittedAt: true, reason: true,
      bed: { select: { bedNo: true, ward: { select: { name: true } } } },
      doctor: { select: { name: true } },
    },
  });
  if (!adm) return null;
  return {
    id: adm.id,
    ipNumber: adm.ipNumber,
    admittedAt: adm.admittedAt,
    wardName: adm.bed?.ward?.name ?? "-",
    bedNo: adm.bed?.bedNo ?? "-",
    doctorName: adm.doctor?.name ?? "-",
    reason: adm.reason,
  };
}

/**
 * TRANSFER a patient to another bed, mid-stay.
 *
 * General → ICU is the single most common event in a hospital, and until now the
 * only way to do it was discharge-and-readmit - which SPLITS ONE STAY INTO TWO
 * BILLS and hands the family two invoices for one illness.
 *
 * Instead: close the current BedStay, open a new one at the new ward's rate. The
 * old bed is freed, the new one taken, atomically. The discharge bill then prices
 * each leg on its own - 3 days General, 4 days ICU - which is both what actually
 * happened and what the patient should pay.
 */
export async function transferBed(
  actor: AuthUser,
  input: { admissionId: string; toBedId: string; reason?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ ipNumber: string; fromWard: string; fromBed: string; toWard: string; toBed: string; newDailyCharge: string }> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const adm = await tx.admission.findUnique({
      where: { id: input.admissionId },
      select: {
        id: true, ipNumber: true, status: true, bedId: true,
        bed: { select: { bedNo: true, ward: { select: { name: true } } } },
      },
    });
    if (!adm) throw new ApiError(404, "Admission not found");
    if (adm.status !== "ADMITTED") throw new ApiError(400, "That patient has already been discharged");
    if (adm.bedId === input.toBedId) throw new ApiError(400, "They're already in that bed");

    const toBed = await tx.bed.findUnique({
      where: { id: input.toBedId },
      select: {
        id: true, bedNo: true, status: true,
        ward: { select: { name: true, dailyCharge: true, gstRatePct: true } },
      },
    });
    if (!toBed) throw new ApiError(404, "That bed doesn't exist");
    if (toBed.status !== "AVAILABLE") throw new ApiError(409, "That bed isn't free");

    // Atomic claim - two clerks can't move two patients into one bed.
    const claim = await tx.bed.updateMany({
      where: { id: toBed.id, status: "AVAILABLE" },
      data: { status: "OCCUPIED" },
    });
    if (claim.count === 0) throw new ApiError(409, "That bed was just taken. Pick another.");

    const now = new Date();

    // close the leg they're leaving
    await tx.bedStay.updateMany({
      where: { admissionId: adm.id, toDate: null },
      data: { toDate: now },
    });

    // open the leg they're entering, priced at TODAY's rate for that ward
    await tx.bedStay.create({
      data: {
        admissionId: adm.id,
        bedId: toBed.id,
        wardName: toBed.ward.name,
        dailyCharge: toBed.ward.dailyCharge,
        gstRatePct: toBed.ward.gstRatePct,
        fromDate: now,
        reason: input.reason?.trim() || null,
        movedById: actor.id,
      },
    });

    // free the old bed, point the admission at the new one
    if (adm.bedId) {
      await tx.bed.update({ where: { id: adm.bedId }, data: { status: "AVAILABLE" } });
    }
    await tx.admission.update({
      where: { id: adm.id },
      data: { bedId: toBed.id, wardNameAtAdmit: toBed.ward.name, dailyChargeAtAdmit: toBed.ward.dailyCharge },
    });

    await logAudit(actor, {
      action: "BED_TRANSFERRED",
      targetTable: "Admission",
      targetId: adm.id,
      meta: {
        ipNumber: adm.ipNumber,
        from: `${adm.bed?.ward?.name} ${adm.bed?.bedNo}`,
        to: `${toBed.ward.name} ${toBed.bedNo}`,
        reason: input.reason ?? null,
      },
      ...ctx,
    }, tx);

    return {
      ipNumber: adm.ipNumber,
      fromWard: adm.bed?.ward?.name ?? "-",
      fromBed: adm.bed?.bedNo ?? "-",
      toWard: toBed.ward.name,
      toBed: toBed.bedNo,
      newDailyCharge: toBed.ward.dailyCharge.toString(),
    };
  });
}

/**
 * The deposit taken at admission.
 *
 * Every hospital takes one. Without it a family can run up lakhs and walk out,
 * and the hospital has no recourse. Adjusted against the discharge bill - and if
 * the advance turns out to EXCEED the final bill, the difference is refunded,
 * not quietly kept.
 */
export async function addAdvance(
  actor: AuthUser,
  input: { admissionId: string; amount: number; mode: string; reference?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{
  ipNumber: string; totalAdvance: string;
  /** The slip just created - reception prints this and hands it over. */
  advance: { id: string; receiptNo: string; amount: string; mode: string };
}> {
  if (!(input.amount > 0)) throw new ApiError(400, "An advance must be more than ₹0");

  const adm = await prisma.admission.findUnique({
    where: { id: input.admissionId },
    select: {
      id: true, ipNumber: true, status: true,
      attendantPhone: true,
      patient: { select: { fullName: true, phone: true } },
    },
  });
  if (!adm) throw new ApiError(404, "Admission not found");
  if (adm.status !== "ADMITTED") throw new ApiError(400, "That patient has already been discharged");

  // Number and row are created together: a receipt number that exists without
  // the money behind it (or money without a number) is an unreconcilable gap in
  // the cash book. `nextId` enrols in the transaction so a rollback burns neither.
  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const receiptNo = await nextId("ADV", { tx });
    return tx.admissionAdvance.create({
      data: {
        admissionId: adm.id,
        receiptNo,
        // validated upstream against the PaymentMode values; narrow for Prisma
        mode: input.mode as PaymentMode,
        amount: Math.round(input.amount * 100) / 100,
        reference: input.reference?.trim() || null,
        receivedById: actor.id,
      },
      select: { id: true, receiptNo: true, amount: true, mode: true },
    });
  });

  const all = await prisma.admissionAdvance.findMany({
    where: { admissionId: adm.id },
    select: { amount: true },
  });
  const total = all.reduce((s: number, a: { amount: { toString(): string } }) => s + Number(a.amount.toString()), 0);

  await logAudit(actor, {
    action: "IPD_ADVANCE_TAKEN",
    targetTable: "Admission",
    targetId: adm.id,
    meta: { ipNumber: adm.ipNumber, receiptNo: created.receiptNo, amount: input.amount, mode: input.mode },
    ...ctx,
  });

  // A deposit is the one payment with no bill behind it - the family hands over
  // cash and gets a slip that lives in a ward bag for a week. This is the copy
  // that survives, and the figure it names is what comes off the final bill.
  await notifyAdvanceReceived(adm.attendantPhone?.trim() || adm.patient.phone, {
    name: adm.patient.fullName,
    amount: input.amount,
    ipNumber: adm.ipNumber,
  });

  return {
    ipNumber: adm.ipNumber,
    totalAdvance: total.toFixed(2),
    advance: {
      id: created.id,
      receiptNo: created.receiptNo ?? "",
      amount: created.amount.toString(),
      mode: created.mode,
    },
  };
}

/**
 * Everything the printed advance slip needs, in one fetch.
 *
 * Deliberately NOT an invoice: no GST split, no HSN, no "tax invoice" wording.
 * It acknowledges money held against a stay. The tax document is the discharge
 * bill, where this deposit reappears as a credit - so the slip says so in as
 * many words, to stop a family treating it as their final bill.
 */
export async function advancePrintData(advanceId: string): Promise<{
  hospital: { legalName: string; addressLine: string; city: string; state: string; stateCode: string; pincode: string; gstin: string | null; phone: string | null } | null;
  advance: { id: string; receiptNo: string | null; amount: string; mode: string; reference: string | null; takenAt: string; receivedBy: string };
  admission: { ipNumber: string; ward: string; bedNo: string; admittedAt: string; doctorName: string };
  patient: { displayId: string; fullName: string; phone: string; age: number | null; gender: string | null; address: string | null };
  /** Every advance on this stay, so the slip can show the running deposit. */
  totalAdvance: string;
}> {
  const a = await prisma.admissionAdvance.findUnique({
    where: { id: advanceId },
    select: {
      id: true, receiptNo: true, amount: true, mode: true, reference: true, createdAt: true,
      receivedBy: { select: { name: true } },
      admission: {
        select: {
          id: true, ipNumber: true, admittedAt: true,
          bed: { select: { bedNo: true, ward: { select: { name: true } } } },
          doctor: { select: { name: true } },
          patient: { select: { displayId: true, fullName: true, phone: true, age: true, gender: true, address: true } },
        },
      },
    },
  });
  if (!a) throw new ApiError(404, "That advance receipt doesn't exist");

  const siblings = await prisma.admissionAdvance.findMany({
    where: { admissionId: a.admission.id },
    select: { amount: true },
  });
  const total = siblings.reduce((s: number, x: { amount: { toString(): string } }) => s + Number(x.amount.toString()), 0);

  const hospital = await prisma.hospitalConfig.findFirst();

  return {
    hospital,
    advance: {
      id: a.id,
      receiptNo: a.receiptNo,
      amount: a.amount.toString(),
      mode: a.mode,
      reference: a.reference,
      takenAt: a.createdAt.toISOString(),
      receivedBy: a.receivedBy.name,
    },
    admission: {
      ipNumber: a.admission.ipNumber,
      ward: a.admission.bed.ward.name,
      bedNo: a.admission.bed.bedNo,
      admittedAt: a.admission.admittedAt.toISOString(),
      doctorName: a.admission.doctor.name,
    },
    patient: a.admission.patient,
    totalAdvance: total.toFixed(2),
  };
}

/** Free beds a patient could be moved INTO - never their own, never occupied. */
export async function transferTargets(admissionId: string): Promise<{
  wards: { id: string; name: string; dailyCharge: string; gstRatePct: string; beds: { id: string; bedNo: string }[] }[];
}> {
  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: { bedId: true },
  });
  const wards = await prisma.ward.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, dailyCharge: true, gstRatePct: true,
      beds: {
        where: { status: "AVAILABLE", id: { not: adm?.bedId ?? "" } },
        orderBy: { bedNo: "asc" },
        select: { id: true, bedNo: true },
      },
    },
  });
  return {
    wards: wards
      .filter((w: { beds: unknown[] }) => w.beds.length > 0)
      .map((w: { id: string; name: string; dailyCharge: { toString(): string }; gstRatePct: { toString(): string }; beds: { id: string; bedNo: string }[] }) => ({
        id: w.id, name: w.name,
        dailyCharge: w.dailyCharge.toString(),
        gstRatePct: w.gstRatePct.toString(),
        beds: w.beds,
      })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DETAILED BILL - the document that actually goes to the insurer.
// ─────────────────────────────────────────────────────────────────────────────
//
// This hospital does not file claims through anybody's API. Somebody prints the
// bill, attaches it to the policy paperwork, and it goes to the TPA - so the
// PRINTED SHEET is the deliverable, not a screen. It replaces a bill the desk
// assembles by hand from the ward file today.
//
// Two things follow from that, and they drive the shape below:
//
//   1. IT IS GROUPED, WITH SUBTOTALS. An assessor reads ward charges against the
//      room entitlement, doctor visits against the number of days, and
//      investigations against the diagnosis. One flat list of forty lines makes
//      them do that sorting themselves, and a claim that is tedious to assess is
//      a claim that gets queried.
//
//   2. IT CARRIES A BILL NUMBER, ALWAYS. That number is how the hospital and the
//      TPA name the same document three weeks later. A stay still running has no
//      final invoice, so it gets a clearly-marked PROVISIONAL number off the IP
//      number rather than a blank - a pre-authorisation goes out mid-stay and it
//      still has to be quotable.

export interface BillLineDTO {
  /** Investigations and dispensed items carry one; ward and service lines do not. */
  date: string | null;
  issueNo: string | null;
  code: string | null;
  description: string;
  batchNo: string | null;
  expiry: string | null;
  rate: string;
  qty: number;
  amount: string;
}

export interface BillGroupDTO {
  title: string;
  /** Second-level heading, as on the paper bill ("LABORATORY" under INVESTIGATIONS). */
  subtitle: string | null;
  lines: BillLineDTO[];
  total: string;
}

export interface DetailedBillDTO {
  hospital: {
    legalName: string; addressLine: string; city: string; state: string;
    pincode: string; phone: string | null; gstin: string | null; logoDataUrl: string | null;
  } | null;
  /** True until the stay is closed and a real invoice exists. */
  provisional: boolean;
  billNo: string;
  billedAt: string;
  patient: { fullName: string; displayId: string; age: number | null; gender: string | null; phone: string };
  admission: {
    ipNumber: string; doctor: string; department: string;
    ward: string; bedNo: string; admittedAt: string; dischargedAt: string | null;
  };
  /** "Source Type" on the paper bill - INSURANCE or SELF. */
  sourceType: string;
  insurer: string | null;
  policyNo: string | null;
  groups: BillGroupDTO[];
  gross: string;
  discount: string;
  gst: string;
  netBill: string;
  advance: string;
  netPayable: string;
}

/** Which printed heading each running-tab category is filed under. */
const BILL_SECTION: Record<string, string> = {
  DOCTOR_VISIT: "DOCTOR VISITING CHARGES",
  INVESTIGATION: "INVESTIGATIONS",
  PHARMACY: "PHARMACY",
  PROCEDURE: "SERVICES",
  NURSING: "SERVICES",
  OXYGEN: "SERVICES",
  CONSUMABLE: "SERVICES",
  OTHER: "SERVICES",
};

export async function detailedBillData(admissionId: string): Promise<DetailedBillDTO> {
  const a = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true,
      wardNameAtAdmit: true, dailyChargeAtAdmit: true,
      payerType: true, insurer: true, policyNo: true,
      bed: { select: { bedNo: true } },
      doctor: { select: { name: true, department: true } },
      patient: { select: { fullName: true, displayId: true, age: true, gender: true, phone: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: { category: true, description: true, qty: true, unitPrice: true, sourceRef: true, createdAt: true },
      },
      bedStays: {
        orderBy: { fromDate: "asc" },
        select: { wardName: true, dailyCharge: true, fromDate: true, toDate: true, bed: { select: { bedNo: true } } },
      },
      labTests: {
        // Only tests no invoice has billed yet. A test that HAS been invoiced
        // arrives below as an invoice line instead - counting it from both
        // sources would bill the insurer twice for one sample.
        where: { invoiceItems: { none: {} } },
        orderBy: { createdAt: "asc" },
        select: { testName: true, priceAtOrder: true, createdAt: true, orderGroupId: true, catalog: { select: { code: true } } },
      },
      advances: { select: { amount: true } },
      invoices: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        select: {
          receiptNo: true, source: true, createdAt: true, payer: true,
          discountAmount: true, cgstAmount: true, sgstAmount: true,
          items: {
            select: {
              description: true, hsnSac: true, qty: true, unitPrice: true, amount: true,
              batch: { select: { batchNo: true, expiryDate: true } },
            },
          },
        },
      },
    },
  });
  if (!a) throw new ApiError(404, "Admission not found");

  const end = a.dischargedAt ?? new Date();
  const days = stayDays(a.admittedAt, end);
  const num = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));
  const m2 = (n: number) => round2(n).toFixed(2);

  const groups: BillGroupDTO[] = [];
  const push = (title: string, subtitle: string | null, lines: BillLineDTO[]) => {
    if (!lines.length) return;
    groups.push({ title, subtitle, lines, total: m2(lines.reduce((s, l) => round2(s + Number(l.amount)), 0)) });
  };

  // ── WARD ── one line per LEG, so a General to ICU transfer prints as two rows
  // at two rates. An insurer paying an ICU entitlement has to see which nights
  // were actually ICU, and one averaged line cannot tell them.
  const wardLines: BillLineDTO[] = a.bedStays.length
    ? a.bedStays.map((st) => {
        const d = stayDays(st.fromDate, st.toDate ?? end);
        const rate = num(st.dailyCharge);
        return {
          date: null, issueNo: null, code: null,
          description: `${st.wardName}${st.bed?.bedNo ? ` - ${st.bed.bedNo}` : ""}`,
          batchNo: null, expiry: null,
          rate: m2(rate), qty: d, amount: m2(rate * d),
        };
      })
    : [{
        date: null, issueNo: null, code: null,
        description: `${a.wardNameAtAdmit}${a.bed?.bedNo ? ` - ${a.bed.bedNo}` : ""}`,
        batchNo: null, expiry: null,
        rate: m2(num(a.dailyChargeAtAdmit)), qty: days, amount: m2(num(a.dailyChargeAtAdmit) * days),
      }];
  push("WARD CHARGES", null, wardLines);

  // ── The running tab, filed under the heading each category belongs to ──
  const bySection = new Map<string, BillLineDTO[]>();
  for (const c of a.charges) {
    const section = BILL_SECTION[c.category] ?? "SERVICES";
    const rate = num(c.unitPrice);
    bySection.set(section, [
      ...(bySection.get(section) ?? []),
      {
        date: c.createdAt.toISOString(),
        issueNo: c.sourceRef, code: null,
        description: c.description,
        batchNo: null, expiry: null,
        rate: m2(rate), qty: c.qty, amount: m2(rate * c.qty),
      },
    ]);
  }

  // ── THE OTHER COUNTERS' BILLS, ON AN INSURANCE CLAIM ──
  //
  // Pharmacy and lab raise their own invoices against the stay and settle at
  // their own counters. That is right for a self-paying family - three counters,
  // three bills, each paid where it was incurred - and it is left exactly as it
  // was for them.
  //
  // It is wrong for a cashless claim. The insurer settles ONE document for the
  // admission; medicines and investigations billed on separate sheets simply do
  // not reach it, so the hospital treats the patient and then never asks anyone
  // for the cost of the drugs. So on an insurance stay those lines are folded in
  // here, under their own headings, with the subtotals an assessor reads.
  //
  // The separate invoices still EXIST and are untouched - this changes what the
  // claim bill shows, not what was billed.
  const isInsurance = a.payerType === "INSURANCE";
  if (isInsurance) {
    const SECTION_OF: Record<string, string> = {
      PHARMACY: "PHARMACY", LAB: "INVESTIGATIONS", OTHER: "SERVICES", CONSULTATION: "SERVICES",
    };
    for (const inv of a.invoices) {
      // The IPD invoice is this bill, not an input to it.
      if (inv.source === "IPD") continue;
      // Only what is actually going to the insurer. A pharmacy bill the family
      // already paid in cash at the window stays SELF_PAY (see the backfill),
      // and putting it on the claim would ask the insurer for money the hospital
      // has already taken.
      if (inv.payer !== "INSURANCE") continue;
      const section = SECTION_OF[inv.source] ?? "SERVICES";
      for (const it of inv.items) {
        bySection.set(section, [
          ...(bySection.get(section) ?? []),
          {
            date: inv.createdAt.toISOString(),
            // The receipt number doubles as the issue number, so an assessor
            // querying one line can be pointed at the document it came from.
            issueNo: inv.receiptNo,
            code: it.hsnSac,
            description: it.description,
            batchNo: it.batch?.batchNo ?? null,
            // MM/YYYY - how an expiry is printed on a strip and how an assessor
            // checking a pharmacy line expects to read it. A full timestamp in a
            // 8%-wide column would just be truncated.
            expiry: it.batch?.expiryDate
              ? `${String(it.batch.expiryDate.getMonth() + 1).padStart(2, "0")}/${it.batch.expiryDate.getFullYear()}`
              : null,
            rate: m2(num(it.unitPrice)), qty: it.qty, amount: m2(num(it.amount)),
          },
        ]);
      }
    }
  }

  push("DOCTOR VISITING CHARGES", null, bySection.get("DOCTOR VISITING CHARGES") ?? []);

  // Nursing care is per-day and derived rather than stored - the same figure the
  // ward sheet and the discharge bill have always shown.
  push("SERVICES", "OTHER SERVICES", [
    ...(bySection.get("SERVICES") ?? []),
    {
      date: null, issueNo: null, code: null,
      description: "Nursing Charges",
      batchNo: null, expiry: null,
      rate: m2(NURSE_FEE_PER_DAY), qty: days, amount: m2(NURSE_FEE_PER_DAY * days),
    },
  ]);

  // ── Investigations ── the lab's own rows plus anything the ward booked as an
  // investigation on the tab. The order id doubles as the issue number, so one
  // sample reads as one issue exactly as the lab raised it.
  const labLines: BillLineDTO[] = a.labTests.map((t) => ({
    date: t.createdAt.toISOString(),
    issueNo: t.orderGroupId ? t.orderGroupId.slice(-8).toUpperCase() : null,
    code: t.catalog?.code ?? null,
    description: t.testName,
    batchNo: null, expiry: null,
    rate: m2(num(t.priceAtOrder)), qty: 1, amount: m2(num(t.priceAtOrder)),
  }));
  // The invoice line wins over the raw test where both describe the same thing.
  //
  // labTestId now ties the two together (see labs.service) and the query above
  // already drops any test an invoice has billed - but only for tests ordered
  // since that link existed. Rows written before it have no link at all, and on
  // those the same investigation would be listed twice and charged twice. This
  // is the belt for the older rows: the invoice is the billed document, so a
  // test whose name is already on a folded-in invoice line is dropped here.
  const invoicedInvestigations = new Set(
    (bySection.get("INVESTIGATIONS") ?? []).map((l) => l.description.trim().toLowerCase())
  );
  push("INVESTIGATIONS", "LABORATORY", [
    ...labLines.filter((l) => !invoicedInvestigations.has(l.description.trim().toLowerCase())),
    ...(bySection.get("INVESTIGATIONS") ?? []),
  ]);

  push("PHARMACY", null, bySection.get("PHARMACY") ?? []);

  // ── The money block ──
  //
  // The bill number and the tax figures come from the IPD invoice specifically -
  // the stay's own document. Pharmacy and lab invoices are folded into the lines
  // above on a claim, but they are not what this sheet IS, and their receipt
  // numbers must never end up in the "Bill No" box an insurer files it under.
  const gross = groups.reduce((s, g) => round2(s + Number(g.total)), 0);
  const inv = a.invoices.find((i) => i.source === "IPD");
  const discount = num(inv?.discountAmount);
  const gst = round2(num(inv?.cgstAmount) + num(inv?.sgstAmount));
  const netBill = round2(gross - discount + gst);
  const advance = a.advances.reduce((s, x) => round2(s + num(x.amount)), 0);

  return {
    hospital: await prisma.hospitalConfig.findFirst({
      select: {
        legalName: true, addressLine: true, city: true, state: true,
        pincode: true, phone: true, gstin: true, logoDataUrl: true,
      },
    }),
    // A stay still in a bed has no final invoice, and saying otherwise on a
    // document an insurer keeps would be a lie with a number on it.
    provisional: !inv,
    billNo: inv?.receiptNo ?? `${a.ipNumber}-P`,
    billedAt: (inv?.createdAt ?? new Date()).toISOString(),
    patient: a.patient,
    admission: {
      ipNumber: a.ipNumber,
      doctor: a.doctor.name,
      department: a.doctor.department,
      ward: a.wardNameAtAdmit,
      bedNo: a.bed?.bedNo ?? "-",
      admittedAt: a.admittedAt.toISOString(),
      dischargedAt: a.dischargedAt?.toISOString() ?? null,
    },
    sourceType: a.payerType === "INSURANCE" ? "INSURANCE" : "SELF",
    insurer: a.insurer,
    policyNo: a.policyNo,
    groups,
    gross: m2(gross),
    discount: m2(discount),
    gst: m2(gst),
    netBill: m2(netBill),
    advance: m2(advance),
    netPayable: m2(Math.max(0, netBill - advance)),
  };
}
