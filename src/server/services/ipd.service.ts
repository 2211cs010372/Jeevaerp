import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { logAudit } from "./audit.service";
import { splitInvoice } from "@/lib/insurance-split";
import { createInvoice, updateInvoice, recordPayment, getInvoice, syncStayCoverage, type PaymentModeT } from "./billing.service";
import { ADVANCE_REF_PREFIX, advancePaymentRef, applyAdvances, heldAsOf, isAdvanceAdjustment, takenOnStayBill } from "@/server/billing/advances";
import { notifyAdmitted, notifyDischarged, notifyAdvanceReceived } from "./notify.service";
// One rounding definition across the whole system - money must not be
// rounded two different ways in two different files. `resolveChargeDate` is the
// same idea for a date a desk typed: one rule, next to the bill-date one.
import { r2 as round2, resolveChargeDate, ChargeDateError, wallClock } from "@/server/billing/calc";
import { getSettings } from "./admin.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { mergeAdvice } from "@/lib/advised-lab";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma, PaymentMode, ChargeCategory } from "@prisma/client";
import { bedLabel } from "@/lib/beds";
import { dateOnlyISO, parseLocalDate } from "@/lib/date";
import { perUnitPrice } from "@/lib/pharmacy/pack";
import { ipServicesBill, bucketOfSection, isDiscountable, type IpBillBucket } from "@/lib/ip-services-bill";
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

/**
 * ONE DAY OF A STAY IS BILLED ONCE, EVEN IF THE PATIENT MOVED THAT DAY.
 *
 * Each leg used to be priced with `stayDays(from, to)` on its own, and that
 * function has a `Math.max(1, …)` floor - rightly, since occupying a bed for an
 * hour is a day's occupancy. Applied per leg it double-counts: a patient moved
 * from General to Sharing bills a full day in BOTH, so one transfer silently
 * added a day to the stay. A real case on this database - moved after ONE
 * MINUTE - came to Rs 6,300 of bed charges on a stay one day old.
 *
 * So the days are DISTRIBUTED rather than computed leg by leg. The stay is cut
 * into day slots from the admission time, and each slot goes to the ward the
 * patient spent MOST of it in. Two consequences, both wanted:
 *
 *   The legs always sum to the stay's own day count. Bed charges can no longer
 *   disagree with the number of days the bill says the patient was here.
 *
 *   A ward passed through briefly bills nothing. It still PRINTS - the transfer
 *   is part of the record - it just carries no days, which is the honest answer
 *   to "what did that hour in General cost".
 */
export function splitStayDays(
  admittedAt: Date,
  end: Date,
  legs: { fromDate: Date; toDate: Date | null }[],
): number[] {
  const out = new Array(legs.length).fill(0);
  if (!legs.length) return out;

  const total = stayDays(admittedAt, end);
  const endMs = end.getTime();

  for (let n = 0; n < total; n++) {
    const slotStart = admittedAt.getTime() + n * DAY_MS;
    const slotEnd = Math.min(slotStart + DAY_MS, endMs);

    let bestLeg = 0;
    let bestOverlap = -1;
    for (let i = 0; i < legs.length; i++) {
      const from = legs[i].fromDate.getTime();
      const to = legs[i].toDate ? legs[i].toDate!.getTime() : endMs;
      const overlap = Math.min(slotEnd, to) - Math.max(slotStart, from);
      // `>` not `>=`: on an exact tie the EARLIER leg keeps the day, so a
      // transfer at the stroke of a slot boundary does not shunt the day
      // forward onto a ward the patient had not reached yet.
      if (overlap > bestOverlap) { bestOverlap = overlap; bestLeg = i; }
    }
    out[bestLeg] += 1;
  }
  return out;
}

/** A bed leg as every day-count path needs to see it. */
type BilledLeg = { fromDate: Date; toDate: Date | null; billedDays?: number | null };

/**
 * WHAT EACH BED LEG IS BILLED FOR - the derived split, with a desk's deliberate
 * override on top.
 *
 * `splitStayDays` answers "where was the patient", and that is the right answer
 * almost always. It is not the answer when a stay is priced some other way: the
 * first few days billed as a bed and the rest raised as its own line, because it
 * is a package, or a procedure, or a rate the insurer settles separately. A desk
 * with nowhere to record that was putting a negative adjustment on the tab.
 *
 * So `billedDays` on the leg wins where it is set, and NOTHING else changes:
 * null - which is every existing row and every new one - still reads the dates.
 *
 * ONE function, called by the running tab, the discharge invoice and the claim
 * bill. They read one day count or they drift, and the drift shows up as a
 * claim bill and a tax invoice that disagree about how many nights a bed was.
 */
export function billedLegDays(admittedAt: Date, end: Date, legs: BilledLeg[]): number[] {
  const derived = splitStayDays(admittedAt, end, legs);
  return derived.map((d, i) => {
    const override = legs[i].billedDays;
    // Negative is rejected at the door in correctStayBilling; floored here too,
    // because a stored -1 would subtract a night from a bill rather than fail.
    return override == null ? d : Math.max(0, override);
  });
}

/**
 * Nights of the stay that NO bed line covers, once the overrides are applied.
 *
 * Zero on an ordinary stay - the split hands out every night. Above zero only
 * where a desk has capped a bed deliberately, and then it is the number the
 * screens have to say out loud: those nights are not on the bed line, and the
 * remainder was supposed to be raised as its own charge. A cap nobody finished
 * is an under-billed stay, and it is invisible unless something counts it.
 */
export function uncoveredStayDays(admittedAt: Date, end: Date, legs: BilledLeg[]): number {
  if (!legs.length) return 0;
  const billed = billedLegDays(admittedAt, end, legs).reduce((t, d) => t + d, 0);
  return Math.max(0, stayDays(admittedAt, end) - billed);
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
        displayId: string; fullName: string; phone?: string; ipNumber: string; admissionId: string;
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
            select: { id: true, ipNumber: true, admittedAt: true, patient: { select: { displayId: true, fullName: true, phone: true } } },
          },
        },
      },
    },
  });

  type WardRow = {
    id: string; name: string; category: string; floor: string | null;
    dailyCharge: { toString(): string }; gstRatePct: { toString(): string };
    beds: { id: string; bedNo: string; status: string; admissions: { id: string; ipNumber: string; admittedAt: Date; patient: { displayId: string; fullName: string; phone: string } }[] }[];
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
              displayId: adm.patient.displayId, fullName: adm.patient.fullName, phone: adm.patient.phone,
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

    // An insurance stay with no insurer is not an insurance stay - it is a stay
    // the desk half-flagged. The insurance room would see a row it cannot act on,
    // and would have to ring the ward to find out who the insurer even is.
    //
    // THE POLICY NUMBER IS NOT REQUIRED HERE, deliberately. It used to be, and it
    // blocked admissions at the worst possible moment: a patient is being wheeled
    // in and the card is in a bag at home. The insurance desk asks the family for
    // the policy and member number when it works the claim, which is the same
    // conversation it was always going to have.
    const payerType = input.payerType ?? "SELF_PAY";
    if (payerType === "INSURANCE" && !nn(input.insurer)) {
      throw new ApiError(400, "An insurance admission needs the insurer");
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
      select: { id: true, admittedAt: true },
    });

    // ── THE FIRST BED LEG OPENS WITH THE STAY ──
    //
    // It did not, and `transferBed` assumed it had: that function CLOSES the
    // open leg and opens a new one, so the first transfer of a stay closed
    // nothing and left exactly one leg, starting at the moment of the move. The
    // bill then prices legs when any exist - so every night before the transfer
    // silently vanished from it. Moving a patient to ICU on day three billed
    // ICU alone and gave the first three days away.
    //
    // Same rate, same ward, same start as the admission, so nothing changes for
    // a stay nobody moves: one leg from admittedAt with no end date bills
    // exactly what `days × dailyChargeAtAdmit` billed before.
    await tx.bedStay.create({
      data: {
        admissionId: adm.id,
        bedId: input.bedId,
        wardName: bed.ward.name,
        dailyCharge: bed.ward.dailyCharge,
        gstRatePct: bed.ward.gstRatePct,
        fromDate: adm.admittedAt,
        movedById: actor.id,
      },
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
      // ── A PRE-AUTH RAISED BEFORE THE PATIENT ARRIVED ──
      //
      // A planned surgery is authorised days ahead, while there is no admission
      // to attach the claim to - so that claim carries admissionId = null. This
      // block used to ignore it and open a SECOND, blank draft, which broke the
      // planned path in two places at once: the desk saw two claims for one stay
      // and could not tell which was real, and - the expensive one - actOnClaim
      // only spreads an approval across bills when the claim HAS an admission,
      // so the Rs 60,000 the insurer had already agreed to never reached a
      // single invoice. The stay read as wholly the family's.
      //
      // So an open, unattached claim for this patient is ADOPTED by the stay
      // instead. Newest first: if a desk raised two, the live one is the one
      // they just made.
      const existing = await tx.insuranceClaim.findFirst({
        where: {
          patientId: patient.id,
          admissionId: null,
          status: { notIn: ["SETTLED", "REJECTED", "CLOSED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, claimNo: true, status: true },
      });

      if (existing) {
        await tx.insuranceClaim.update({
          where: { id: existing.id },
          data: { admissionId: adm.id },
        });
        await tx.claimEvent.create({
          data: {
            claimId: existing.id,
            kind: "NOTE",
            detail: `Attached to admission ${ipNumber} - the pre-authorisation was raised before the patient was admitted`,
            byId: actor.id,
          },
        });
        // An approval that predates the stay has never been spread over a bill.
        // There are none yet either, but each one raised from here on re-runs
        // this, so the cover lands as the bills appear.
        await syncStayCoverage(tx, adm.id);
      } else {
      const claimNo = await nextId("CLAIM", { tx });
      await tx.insuranceClaim.create({
        data: {
          claimNo,
          patientId: patient.id,
          admissionId: adm.id,
          insurer: nn(input.insurer)!,
          // EMPTY, NOT ABSENT. The column is NOT NULL and the desk is no longer
          // asked for a policy number at admission, so the draft claim opens
          // without one and the insurance room fills it in with the amount. An
          // empty string says "nobody has given us this yet"; inventing a
          // placeholder like "PENDING" would be a policy number that reads like
          // a real one on a document that goes to a TPA.
          policyNo: nn(input.policyNo) ?? "",
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
              detail: `Opened automatically on admission (${ipNumber}) - needs the policy number and an amount before it can be submitted`,
              byId: actor.id,
            },
          },
        },
      });
      }
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

export interface InpatientFilters {
  q?: string;
  mobile?: string;
  ip?: string;
  op?: string;
  name?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
}

export interface InpatientRowDTO {
  id: string; ipNumber: string; status: string;
  admittedAt: string; dischargedAt: string | null; days: number;
  ward: string; bedNo: string; dailyCharge: string; runningCharge: string;
  bedCharge: string; extrasCharge: string; extras: number;
  reason: string | null; attendantName: string | null; attendantPhone: string | null;
  payerType: string; insurer: string | null; policyNo: string | null;
  doctor: { name: string; department: string };
  patient: { id: string; displayId: string; fullName: string; age: number | null; dob: string | null; gender: string | null; phone: string };
}

/** Everyone currently in a bed, with the running charge so far, optionally filtered. */
export async function currentInpatients(filters?: InpatientFilters): Promise<InpatientRowDTO[]> {
  const where: Prisma.AdmissionWhereInput = {};

  if (filters?.status === "ALL") {
    // No status constraint
  } else if (filters?.status === "DISCHARGED") {
    where.status = { in: CLOSED_STATUS_LIST };
  } else if (filters?.status && filters.status !== "ADMITTED") {
    where.status = filters.status as AdmissionStatusValue;
  } else {
    where.status = "ADMITTED";
  }

  const andClauses: Prisma.AdmissionWhereInput[] = [];

  if (filters?.fromDate?.trim() || filters?.toDate?.trim()) {
    const admittedAtFilter: Prisma.DateTimeFilter = {};
    if (filters.fromDate?.trim()) {
      admittedAtFilter.gte = parseLocalDate(filters.fromDate.trim());
    }
    if (filters.toDate?.trim()) {
      const endOfDay = parseLocalDate(filters.toDate.trim());
      endOfDay.setHours(23, 59, 59, 999);
      admittedAtFilter.lte = endOfDay;
    }
    andClauses.push({ admittedAt: admittedAtFilter });
  }

  if (filters?.mobile?.trim()) {
    const m = filters.mobile.trim();
    andClauses.push({
      OR: [
        { patient: { phone: { contains: m, mode: "insensitive" } } },
        { attendantPhone: { contains: m, mode: "insensitive" } },
      ],
    });
  }

  if (filters?.ip?.trim()) {
    const ip = filters.ip.trim();
    andClauses.push({
      ipNumber: { contains: ip, mode: "insensitive" },
    });
  }

  if (filters?.op?.trim()) {
    const op = filters.op.trim();
    andClauses.push({
      patient: { displayId: { contains: op, mode: "insensitive" } },
    });
  }

  if (filters?.name?.trim()) {
    const name = filters.name.trim();
    andClauses.push({
      patient: { fullName: { contains: name, mode: "insensitive" } },
    });
  }

  if (filters?.q?.trim()) {
    const q = filters.q.trim();
    andClauses.push({
      OR: [
        { patient: { fullName: { contains: q, mode: "insensitive" } } },
        { patient: { displayId: { contains: q, mode: "insensitive" } } },
        { patient: { phone: { contains: q, mode: "insensitive" } } },
        { ipNumber: { contains: q, mode: "insensitive" } },
        { attendantName: { contains: q, mode: "insensitive" } },
        { attendantPhone: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  const rows = await prisma.admission.findMany({
    where,
    orderBy: { admittedAt: "desc" },
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true, reason: true,
      attendantName: true, attendantPhone: true,
      payerType: true, insurer: true, policyNo: true,
      dailyChargeAtAdmit: true, wardNameAtAdmit: true,
      bed: { select: { bedNo: true } },
      charges: { select: { qty: true, unitPrice: true } },
      doctor: { select: { name: true, department: true } },
      patient: { select: { id: true, displayId: true, fullName: true, age: true, dob: true, gender: true, phone: true } },
    },
  });

  const now = new Date();
  return rows.map((r: {
    id: string; ipNumber: string; status: string; admittedAt: Date; dischargedAt: Date | null; reason: string | null;
    attendantName: string | null; attendantPhone: string | null;
    payerType: string; insurer: string | null; policyNo: string | null;
    dailyChargeAtAdmit: { toString(): string }; wardNameAtAdmit: string;
    bed: { bedNo: string } | null;
    charges: { qty: number; unitPrice: { toString(): string } }[];
    doctor: { name: string; department: string };
    patient: { id: string; displayId: string; fullName: string; age: number | null; dob: Date | null; gender: string | null; phone: string };
  }) => {
    const end = r.dischargedAt ?? now;
    const days = stayDays(r.admittedAt, end);
    const daily = Number(r.dailyChargeAtAdmit.toString());
    const bedCharge = days * daily;
    // The bed is not the bill. Procedures, oxygen and pharmacy all ride along.
    const extrasCharge = r.charges.reduce((s, c) => s + c.qty * Number(c.unitPrice.toString()), 0);
    return {
      id: r.id, ipNumber: r.ipNumber, status: r.status,
      admittedAt: r.admittedAt.toISOString(),
      dischargedAt: r.dischargedAt ? r.dischargedAt.toISOString() : null,
      days, ward: r.wardNameAtAdmit, bedNo: r.bed?.bedNo ?? "-",
      dailyCharge: daily.toFixed(2),
      bedCharge: bedCharge.toFixed(2),
      extrasCharge: extrasCharge.toFixed(2),
      extras: r.charges.length,
      runningCharge: (bedCharge + extrasCharge).toFixed(2),
      reason: r.reason, attendantName: r.attendantName, attendantPhone: r.attendantPhone,
      payerType: r.payerType, insurer: r.insurer, policyNo: r.policyNo,
      doctor: r.doctor,
      // `dob` is a `@db.Date` - its calendar day is the UTC part. Carried so
      // an admitted infant reads as "11d" rather than as a rounded-down 0.
      patient: { ...r.patient, dob: r.patient.dob ? dateOnlyISO(r.patient.dob) : null },
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
  /** Who settled this stay. A stay an insurer refused has already been flipped
   *  to SELF_PAY by revertBillsToSelfPay, so this is what decides whether the
   *  self-pay services bill may be offered on the row. */
  payerType: string;
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
      status: true, payerType: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true } },
      doctor: { select: { name: true, department: true } },
      invoices: { where: { source: "IPD" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, receiptNo: true, totalAmount: true, status: true } },
    },
  });
  type Row = {
    id: string; ipNumber: string; admittedAt: Date; dischargedAt: Date | null; wardNameAtAdmit: string;
    status: string; payerType: string;
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
      payerType: r.payerType,
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

type BedStayRow = {
  wardName: string; dailyCharge: { toString(): string }; gstRatePct: { toString(): string };
  fromDate: Date; toDate: Date | null; bed: { bedNo: string } | null;
  /** Null = bill the nights the dates say. See billedLegDays. */
  billedDays?: number | null;
};

type IpdBillBase = {
  ipNumber: string;
  admittedAt: Date;
  dischargedAt: Date;
  wardNameAtAdmit: string;
  dailyChargeAtAdmit: { toString(): string };
  gstRatePctAtAdmit: { toString(): string };
  /** Null = the hospital's standard fee. See nursePerDayOf. */
  nursePerDay: { toString(): string } | null;
  bed: { bedNo: string } | null;
  charges: ChargeLine[];
};

/**
 * WHAT AN IPD BILL IS MADE OF: the bed, the nursing, and the running tab.
 *
 * ONE DEFINITION, TWO CALLERS. Discharge builds this to raise the invoice, and a
 * charge corrected AFTER discharge rebuilds it to re-issue that same invoice. If
 * each did its own arithmetic they would drift, and the drift would surface as a
 * claim bill and a tax invoice that disagree about a stay - discovered by a TPA,
 * months later, with no way to tell which one was right.
 *
 * Each BedStay is priced on its own, at the rate that ward carried while the
 * patient was in it: a mid-stay price revision must never reach back and
 * re-price nights already lived.
 */
export function buildIpdInvoiceLines(
  adm: IpdBillBase,
  stays: BedStayRow[],
  opts: { nursing?: boolean } = {},
) {
  const days = stayDays(adm.admittedAt, adm.dischargedAt);

  // Days shared out across the legs, so a transfer cannot bill one day twice -
  // and then any leg a desk has deliberately capped, at the number they capped
  // it to rather than the nights it actually held.
  const legDays = billedLegDays(adm.admittedAt, adm.dischargedAt, stays);
  const bedLines = stays.length > 0
    ? stays.map((st, i) => {
        const d = legDays[i];
        return {
          description: `Bed · ${bedLabel(st.wardName, st.bed?.bedNo)} · ${d} day${d > 1 ? "s" : ""}`,
          qty: d,
          unitPrice: Number(st.dailyCharge.toString()),
          gstRatePct: Number(st.gstRatePct.toString()),
        };
      })
    // Fallback for an admission created before BedStay existed and somehow not
    // backfilled. Never silently bill zero days for a bed someone slept in.
    : [{
        description: `Bed charges · ${adm.wardNameAtAdmit} · ${adm.bed?.bedNo ?? "bed not recorded"} · ${adm.ipNumber} · ${days} day(s)`,
        qty: days,
        unitPrice: Number(adm.dailyChargeAtAdmit.toString()),
        gstRatePct: Number(adm.gstRatePctAtAdmit.toString()),
      }];

  // ── NURSING IS NO LONGER CHARGED, AND OLD BILLS DO NOT LOSE IT ──
  //
  // The hospital withdrew the per-day nursing fee. A stay that was never billed
  // for it must not start being, so this is OFF by default and discharge never
  // asks for it.
  //
  // A RE-ISSUE does ask for it, when the invoice it is rebuilding already
  // carries a nursing line. Rebuilding a closed stay's bill without it would
  // quietly subtract a day-rate per night from a document the family has
  // already paid against and a TPA may have already assessed - the correction
  // was to one charge, and it has to move that charge and nothing else.
  const nurse = nursePerDayOf(adm);

  return [
    ...bedLines,
    ...(opts.nursing
      ? [{
          description: `Nursing care · ${days} day(s) × ₹${nurse}`,
          qty: days,
          unitPrice: nurse,
          gstRatePct: 0,
        }]
      : []),
    // Each line keeps its own GST rate: a ₹5,500 room and a 12% syrup are not
    // taxed the same way.
    ...adm.charges.map((c) => ({
      description: c.description,
      qty: c.qty,
      unitPrice: Number(c.unitPrice.toString()),
      gstRatePct: Number(c.gstRatePct.toString()),
    })),
  ];
}

/**
 * RE-ISSUE A DISCHARGED STAY'S INVOICE FROM ITS CHARGES.
 *
 * A stay's charges used to freeze at discharge, so the insurance desk answering
 * a TPA query on a closed claim could not touch the bill at all. They can now -
 * and the moment a charge moves, the invoice raised at discharge is stale. This
 * puts the two back in step in the same breath.
 *
 * It deliberately delegates to `updateInvoice` rather than writing the invoice
 * itself, because every rule worth having already lives there: a cancelled bill
 * stays cancelled, a bill carrying a live IRN is the government's copy and is
 * refused, the total may not fall below money already collected, and the whole
 * edit is gated behind `billEditingEnabled` for the front desk and the insurance
 * room. Re-implementing any of that here would mean two answers to "may this
 * bill change", which is one more than a tax document can survive.
 *
 * A stay with no IPD invoice yet (discharged before invoicing, or a stay still
 * running) is a no-op, not an error - the charge edit itself is still valid.
 */
async function reissueIpdInvoice(
  actor: AuthUser,
  admissionId: string,
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: {
      ipNumber: true, admittedAt: true, dischargedAt: true,
      wardNameAtAdmit: true, dailyChargeAtAdmit: true, gstRatePctAtAdmit: true,
      nursePerDay: true,
      bed: { select: { bedNo: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: { description: true, qty: true, unitPrice: true, gstRatePct: true, category: true },
      },
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        // The lines it was RAISED with. Nursing is withdrawn for new stays, so
        // whether this rebuild carries one is not a question about today - it
        // is a question about what this bill already said.
        select: { id: true, discountAmount: true, source: true, items: { select: { description: true } } },
      },
    },
  });
  if (!adm?.dischargedAt) return;
  const inv = adm.invoices[0];
  if (!inv) return;

  const stays = await prisma.bedStay.findMany({
    where: { admissionId },
    orderBy: { fromDate: "asc" },
    select: {
      wardName: true, dailyCharge: true, gstRatePct: true, fromDate: true, toDate: true,
      billedDays: true, bed: { select: { bedNo: true } },
    },
  });

  await updateInvoice(
    actor,
    {
      invoiceId: inv.id,
      // A bill raised WITH nursing is re-issued with nursing. Dropping it here
      // would take a day-rate per night off a document already paid against,
      // over a correction to some other line entirely.
      lines: buildIpdInvoiceLines(
        { ...adm, dischargedAt: adm.dischargedAt },
        stays as BedStayRow[],
        { nursing: inv.items.some(isNursingLine) },
      ),
      // The discount was a decision taken at discharge about this stay. A
      // corrected line is not a reason to quietly withdraw it.
      discountAmount: Number(inv.discountAmount.toString()),
    },
    ctx,
  );
}

/**
 * CHANGE A CLOSED STAY'S CHARGE, OR CHANGE NOTHING AT ALL.
 *
 * `updateInvoice` runs its own transaction, so the charge write and the invoice
 * rewrite cannot share one. That leaves a window where the charge has moved and
 * the invoice has not - which is precisely the divergence this whole path exists
 * to prevent, and it is reached by the most ordinary refusal there is: a
 * correction that would drop the bill below money already collected.
 *
 * So the charge change is undone when the re-issue refuses. The desk gets the
 * invoice's own message - "refund the difference first, then edit" - and the
 * stay is exactly as it was before they pressed the button.
 *
 * A stay that is still ADMITTED has no invoice yet and skips all of this: its
 * charges are a running tab, and nothing downstream is stale until discharge
 * raises the bill.
 */
async function withInvoiceInStep<T>(
  actor: AuthUser,
  admissionId: string,
  closed: boolean,
  ctx: { ipAddress?: string; userAgent?: string },
  apply: () => Promise<T>,
  undo: (applied: T) => Promise<void>,
): Promise<T> {
  const applied = await apply();
  if (!closed) return applied;
  try {
    await reissueIpdInvoice(actor, admissionId, ctx);
  } catch (e) {
    await undo(applied);
    throw e;
  }
  return applied;
}

/**
 * Pharmacy and lab bills raised against a stay that are still unpaid.
 *
 * These are SEPARATE invoices, not room-tab charges - the pharmacy and the lab
 * each keep their own document. Which means the discharge desk is the only
 * place they can all be seen together, and the only chance to collect before
 * the patient walks out of the building.
 */
/** One counter bill raised against a stay, and where it stands. */
export interface CounterBillDTO {
  id: string; receiptNo: string; source: string;
  total: string; paid: string; due: string;
  /** PAID · PART · DUE - what the running tab shows against the row. */
  status: BillPaidStatus;
  /** SELF_PAY or INSURANCE, so the tab can say "on the claim". */
  payer: string;
  createdAt: string;
}

/**
 * EVERY pharmacy/lab/other bill on a stay - paid ones included.
 *
 * The running tab used to be fed by `outstandingForAdmission` alone, which
 * drops a bill the moment its balance reaches zero. That was survivable while
 * a ward dispense could not be paid for at the pharmacy window, because nothing
 * ever WAS paid before discharge. Now that the counter can take the money, a
 * medicine settled at 11am vanished off the ward's tab by 11:01 - the one screen
 * that is supposed to show what the stay has cost quietly stopped showing it,
 * and only the patient's invoice history remembered.
 *
 * So the tab reads from here and shows the lot, each marked with its status.
 * `outstandingForAdmission` still filters this down to what is actually owed,
 * because a discharge blocker must only ever count real debt.
 */
export async function counterBillsForAdmission(admissionId: string): Promise<CounterBillDTO[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      admissionId,
      source: { in: ["PHARMACY", "LAB", "OTHER"] },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, source: true, createdAt: true, payer: true,
      totalAmount: true, insuranceCoveredAmount: true,
      payments: { select: { mode: true, amount: true } },
      refunds: { select: { amount: true } },
    },
  });

  return rows.map((i) => {
    // The PATIENT's share, same split the dues screens use - an insurer's part
    // of a bill is not a balance the ward should show as owed by the family.
    const split = splitInvoice({
      totalAmount: Number(i.totalAmount.toString()),
      insuranceCoveredAmount: Number(i.insuranceCoveredAmount.toString()),
      payments: i.payments.map((x) => ({ mode: String(x.mode), amount: Number(x.amount.toString()) })),
      refunds: i.refunds.map((x) => ({ amount: Number(x.amount.toString()) })),
    });
    const due = split.patientBalance;
    const paid = split.patientPaid;
    const status: BillPaidStatus = due <= 0.01 ? "PAID" : paid > 0.01 ? "PART" : "DUE";
    return {
      id: i.id, receiptNo: i.receiptNo, source: i.source,
      total: split.total.toFixed(2), paid: paid.toFixed(2), due: due.toFixed(2),
      status, payer: String(i.payer),
      createdAt: i.createdAt.toISOString(),
    };
  });
}

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
        nursePerDay: true,
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
    select: {
      wardName: true, dailyCharge: true, gstRatePct: true, fromDate: true, toDate: true,
      billedDays: true, bed: { select: { bedNo: true } },
    },
  });

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
      // The bed and the whole running tab - built by the one function a
      // post-discharge correction also rebuilds them with, so the two can never
      // describe the same stay differently.
      //
      // No nursing: the per-day nursing fee is withdrawn, and this is a bill
      // being raised for the first time. Stays billed for it before the
      // withdrawal keep it - see buildIpdInvoiceLines.
      lines: buildIpdInvoiceLines(
        { ...adm, dischargedAt: adm.dischargedAt, charges: adm.charges as ChargeLine[] },
        stays as BedStayRow[],
      ),
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
  //
  // ONE PAYMENT PER DEPOSIT SLIP, NOT ONE LUMP.
  //
  // A family deposits more than once - 3,000 in cash at admission, 5,000 by UPI
  // two days later - and this used to collapse the lot into a single payment
  // carrying the FIRST advance's mode. The invoice then recorded 8,000 of cash
  // against a drawer that had only ever seen 3,000, and the day close could not
  // be made to balance by anyone who did not already know why.
  //
  // Grouping by tender mode fixed the mode, and left the other half wrong: the
  // family holds two numbered receipts and the bill showed one merged line they
  // could tie back to neither. So each deposit is now applied as its own
  // payment, stamped with its own slip number - which preserves the mode by
  // construction, since a deposit only ever had one.
  //
  // Applied oldest first: if the advance overshoots the bill, the money left
  // refundable is the most recent, which is the deposit the family remembers
  // making and the one they will ask about.
  const advances = await prisma.admissionAdvance.findMany({
    where: { admissionId: adm.id },
    orderBy: { createdAt: "asc" },
    select: { amount: true, mode: true, receiptNo: true },
  });
  //
  // The apportionment itself is pure and lives in @/server/billing/advances, so
  // the rule can be tested without standing up Postgres. This loop only walks
  // its answer and writes the rows.
  const toRecord = applyAdvances(
    (advances as { amount: { toString(): string }; mode: PaymentModeT; receiptNo: string | null }[])
      .map((a) => ({ amount: Number(a.amount.toString()), mode: a.mode, receiptNo: a.receiptNo })),
    Number(invoice.balanceDue),
  );
  for (const a of toRecord) {
    await recordPayment(
      actor,
      {
        invoiceId: invoice.id,
        mode: a.mode as PaymentModeT,
        amount: a.amount,
        reference: advancePaymentRef(adm.ipNumber, a.receiptNo),
      },
      ctx
    );
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
  // 30 beds total - the size Jeeva actually runs, so a fresh setup lands on the
  // same shape as the live hospital instead of a 24-bed guess somebody then has
  // to top up by hand.
  const PLAN = [
    { name: "General Ward", category: "GENERAL",      floor: "1st Floor", dailyCharge: 1500, gstRatePct: 0, beds: 10, prefix: "GW" },
    { name: "Semi-Private", category: "SEMI_PRIVATE", floor: "2nd Floor", dailyCharge: 3000, gstRatePct: 0, beds: 6,  prefix: "SP" },
    { name: "Private Room", category: "PRIVATE",      floor: "2nd Floor", dailyCharge: 5500, gstRatePct: 5, beds: 4,  prefix: "PR" },
    { name: "ICU",          category: "ICU",          floor: "3rd Floor", dailyCharge: 8000, gstRatePct: 0, beds: 10, prefix: "ICU" },
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
  if (input.qty < 1) throw new ApiError(400, "Quantity must be at least 1");
  if (input.unitPrice < 0) throw new ApiError(400, "Price can't be negative");

  // A CLOSED STAY IS NO LONGER A REFUSAL. The insurance desk answering a TPA
  // query weeks later has to be able to put a line on the bill; what it must not
  // do is leave the invoice raised at discharge saying something else. So the
  // charge lands and the invoice is rebuilt from it, together or not at all.
  const closed = isClosed(adm.status as AdmissionStatusValue);

  const created = await withInvoiceInStep(
    actor, input.admissionId, closed, ctx,
    () => prisma.admissionCharge.create({
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
      select: { id: true },
    }),
    (row) => prisma.admissionCharge.delete({ where: { id: row.id } }).then(() => undefined),
  );

  await logAudit(actor, {
    action: "IPD_CHARGE_ADDED", targetTable: "Admission", targetId: input.admissionId,
    meta: {
      ipNumber: adm.ipNumber, description: input.description,
      amount: input.qty * input.unitPrice, chargeId: created.id,
      // Worth its own field: a line added to a bill that was already issued is
      // the kind of edit an auditor looks for by name.
      afterDischarge: closed,
    },
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
 *
 * IT ALSO RE-DATES A LINE, and that is not a repricing at all - see
 * `resolveChargeDate`. The ward keys a morning's work in at four in the
 * afternoon, and the tab then prints four days of treatment under one
 * timestamp. Moving the date touches no figure, so it deliberately does NOT
 * re-issue a discharged stay's invoice: the date is not on that document.
 */
export async function updateAdmissionCharge(
  actor: AuthUser,
  chargeId: string,
  input: {
    description?: string; qty?: number; unitPrice?: number; gstRatePct?: number; category?: string;
    /** ISO instant. Writes AdmissionCharge.createdAt - the tab's "Date & time". */
    chargedAt?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const charge = await prisma.admissionCharge.findUnique({
    where: { id: chargeId },
    select: {
      id: true, sourceRef: true, description: true, qty: true, unitPrice: true, gstRatePct: true,
      // Captured so a refused re-issue can put the line back EXACTLY - a rollback
      // that restores the money but not the heading files the charge under the
      // wrong section of the printed claim bill.
      category: true,
      createdAt: true,
      // The stay's own dates, because they are the window a charge date has to
      // land inside - a line dated before the admission is on the wrong stay.
      admission: {
        select: { id: true, status: true, ipNumber: true, admittedAt: true, dischargedAt: true },
      },
    },
  });
  if (!charge) throw new ApiError(404, "Charge not found");
  if (charge.sourceRef) {
    throw new ApiError(400, "This came from a pharmacy dispense. Change it in the pharmacy, not here.");
  }
  // Repricing a CLOSED stay is allowed - it is the whole point of the tariff
  // argument this function exists for, and that argument usually starts after
  // the patient has gone home. The invoice follows the line, or neither moves.
  const closed = isClosed(charge.admission.status as AdmissionStatusValue);
  if (input.qty !== undefined && input.qty < 1) throw new ApiError(400, "Quantity must be at least 1");
  if (input.unitPrice !== undefined && input.unitPrice < 0) throw new ApiError(400, "Price can't be negative");

  let dated: Date | undefined;
  try {
    dated = resolveChargeDate(input.chargedAt, charge.admission);
  } catch (e) {
    // Already worded for the desk - "this patient was admitted on…", with the
    // date they can compare against. Do not flatten it to something generic.
    if (e instanceof ChargeDateError) throw new ApiError(400, e.message);
    throw e;
  }

  const before = {
    description: charge.description,
    qty: charge.qty,
    unitPrice: Number(charge.unitPrice.toString()),
    gstRatePct: Number(charge.gstRatePct.toString()),
    chargedAt: charge.createdAt.toISOString(),
  };
  const after = {
    description: input.description?.trim() || before.description,
    qty: input.qty ?? before.qty,
    unitPrice: input.unitPrice ?? before.unitPrice,
    gstRatePct: input.gstRatePct ?? before.gstRatePct,
    chargedAt: (dated ?? charge.createdAt).toISOString(),
  };

  // Nothing actually moved - don't write a note claiming somebody changed the
  // bill. A ward record full of "changed X to X" is a record nobody reads.
  //
  // The two kinds of change are counted SEPARATELY because only one of them is
  // money: `repriced` is what a discharged stay's invoice has to be re-issued
  // for, and a date-only correction must not drag a filed bill through that.
  const repriced =
    before.description !== after.description || before.qty !== after.qty ||
    before.unitPrice !== after.unitPrice || before.gstRatePct !== after.gstRatePct ||
    (input.category !== undefined && input.category !== null);
  const reDated = before.chargedAt !== after.chargedAt;
  if (!repriced && !reDated) return;

  await withInvoiceInStep(
    actor, charge.admission.id, closed && repriced, ctx,
    async () => {
      await prisma.$transaction(async (tx) => {
        await tx.admissionCharge.update({
          where: { id: chargeId },
          data: {
            ...(input.category ? { category: input.category as ChargeCategory } : {}),
            ...(dated ? { createdAt: dated } : {}),
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
            body: [
              repriced &&
                `Bill line repriced: "${before.description}" ${before.qty} × ₹${before.unitPrice.toFixed(2)}` +
                ` → "${after.description}" ${after.qty} × ₹${after.unitPrice.toFixed(2)}`,
              reDated &&
                `Bill line re-dated: "${after.description}" ${wallClock(new Date(before.chargedAt))}` +
                ` → ${wallClock(new Date(after.chargedAt))}`,
            ].filter(Boolean).join(". ") +
              (closed && repriced ? " (after discharge - invoice re-issued)" : ""),
            authorId: actor.id,
          },
        });
      });
    },
    // Put the figures back exactly. The ward note stays: somebody DID attempt
    // this, and a refused correction on a claim is itself worth reading later.
    async () => {
      await prisma.admissionCharge.update({
        where: { id: chargeId },
        data: {
          category: charge.category,
          createdAt: charge.createdAt,
          description: before.description,
          qty: before.qty,
          unitPrice: before.unitPrice.toFixed(2),
          gstRatePct: before.gstRatePct.toFixed(2),
        },
      });
    },
  );

  await logAudit(actor, {
    action: "IPD_CHARGE_UPDATED", targetTable: "Admission", targetId: charge.admission.id,
    meta: { ipNumber: charge.admission.ipNumber, chargeId, before, after, afterDischarge: closed }, ...ctx,
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
    // The WHOLE row, because a refused re-issue has to put this line back and a
    // line restored with a fresh id and today's timestamp is not the line that
    // was there - it loses who raised it and when, on the one document most
    // likely to be argued over months later.
    select: {
      id: true, sourceRef: true, category: true, description: true, qty: true,
      unitPrice: true, gstRatePct: true, addedById: true, createdAt: true,
      admission: { select: { id: true, status: true, ipNumber: true } },
    },
  });
  if (!charge) throw new ApiError(404, "Charge not found");
  if (charge.sourceRef) {
    // Deleting it here would silently un-bill medicine that physically left the shelf.
    throw new ApiError(400, "This came from a pharmacy dispense. Reverse it in the pharmacy, not here.");
  }
  const closed = isClosed(charge.admission.status as AdmissionStatusValue);

  await withInvoiceInStep(
    actor, charge.admission.id, closed, ctx,
    () => prisma.admissionCharge.delete({ where: { id: chargeId } }).then(() => undefined),
    () => prisma.admissionCharge.create({
      data: {
        id: charge.id,
        admissionId: charge.admission.id,
        category: charge.category,
        description: charge.description,
        qty: charge.qty,
        unitPrice: charge.unitPrice,
        gstRatePct: charge.gstRatePct,
        sourceRef: charge.sourceRef,
        addedById: charge.addedById,
        createdAt: charge.createdAt,
      },
    }).then(() => undefined),
  );

  await logAudit(actor, {
    action: "IPD_CHARGE_REMOVED", targetTable: "Admission", targetId: charge.admission.id,
    meta: {
      ipNumber: charge.admission.ipNumber, chargeId,
      description: charge.description, afterDischarge: closed,
    },
    ...ctx,
  });
}

/**
 * CORRECT WHAT THE STAY IS PRICED ON: its dates, its bed rate, its nursing rate.
 *
 * Everything else on an inpatient bill is a row somebody can edit. These three
 * were not rows at all - the bed came from a ward rate snapshotted onto the
 * admission, nursing came from a constant in this file, and the day count came
 * from two timestamps nothing on any screen could reach. So the three biggest
 * numbers on the bill were the only ones nobody could fix.
 *
 * They go wrong in ordinary ways. A patient admitted at 11pm gets typed in the
 * next morning and the stay bills a day short. A family is moved to a private
 * room on the ward's word before the rate is corrected on the board. An insurer
 * settles nursing at its own tariff. Until now each of those was worked around
 * by adding an "adjustment" line to the tab - which reads, on a claim, as the
 * hospital quietly correcting its own bill, and reads on a discharge sheet as a
 * charge the family is entitled to ask about and nobody can explain.
 *
 * FOUR THINGS HOLD THIS TOGETHER, and they are the reason this is one function
 * rather than three endpoints:
 *
 *   The DAYS and the LEGS move together. `admittedAt` is where the first bed
 *   leg starts; moving one without the other bills a bed from a date the stay
 *   had not begun. A correction that would leave a leg starting after it ended
 *   is refused rather than silently clamped - that is a transfer to fix, not a
 *   date.
 *
 *   The BED RATE is per leg. A patient moved General → ICU on day 3 has two
 *   rates, and one averaged figure cannot tell an insurer which nights were
 *   ICU. `dailyChargeAtAdmit` follows the CURRENT leg, which is what a transfer
 *   already does to it.
 *
 *   A DISCHARGED stay re-issues its invoice, through the same path a repriced
 *   line uses - so the tax document and the claim bill never disagree about a
 *   stay. Every rule worth having lives in `updateInvoice`: a cancelled bill
 *   stays cancelled, a filed IRN is refused, the total may not drop below money
 *   already collected, and the whole edit is gated on `billEditingEnabled`. If
 *   the re-issue refuses, the stay goes back exactly as it was.
 *
 *   The change WRITES ITSELF ONTO THE STAY, with the old figures and the new
 *   ones. "The bill was changed after the treatment" is the first thing an
 *   insurer asks, and this is the answer.
 */
export async function correctStayBilling(
  actor: AuthUser,
  admissionId: string,
  input: {
    /** ISO instant. The time of day matters - see stayDays. */
    admittedAt?: string;
    /** ISO instant. Only on a stay that is already closed. */
    dischargedAt?: string;
    nursePerDay?: number;
    /**
     * Per-leg bed corrections. A leg not named here is left exactly as it was.
     *
     * `billedDays` is how many days this bed is BILLED for, which is not always
     * how many nights it held: undefined leaves the cap alone, null clears it
     * back to billing the stay's dates, and a number caps it there. See
     * BedStay.billedDays for why a desk needs this.
     */
    legs?: { id: string; dailyCharge: number; billedDays?: number | null }[];
    /** The whole-stay bed rate, for a stay with no BedStay rows (pre-migration). */
    bedRate?: number;
    reason?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const a = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true,
      dailyChargeAtAdmit: true, nursePerDay: true,
      bedStays: {
        orderBy: { fromDate: "asc" },
        select: { id: true, wardName: true, dailyCharge: true, fromDate: true, toDate: true, billedDays: true, bed: { select: { bedNo: true } } },
      },
    },
  });
  if (!a) throw new ApiError(404, "Admission not found");
  const closed = isClosed(a.status as AdmissionStatusValue);

  // ── THE DATES ──
  const now = new Date();
  const parse = (iso: string, what: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `That ${what} isn't a date I can read.`);
    return d;
  };
  const beforeAdmittedAt = a.admittedAt;
  const afterAdmittedAt = input.admittedAt ? parse(input.admittedAt, "admission date") : beforeAdmittedAt;
  const beforeDischargedAt = a.dischargedAt;
  const afterDischargedAt = input.dischargedAt ? parse(input.dischargedAt, "discharge date") : beforeDischargedAt;

  if (input.dischargedAt && !closed) {
    // Setting one here would leave a stay holding a bed and carrying an end
    // date, which every board and every day count would then read differently.
    throw new ApiError(400, "This patient is still in a bed. Discharge them from the stay, don't type an end date here.");
  }
  if (afterAdmittedAt > now) throw new ApiError(400, "A stay can't start in the future.");
  if (afterDischargedAt && afterDischargedAt > now) throw new ApiError(400, "A stay can't end in the future.");
  if (afterDischargedAt && afterDischargedAt <= afterAdmittedAt) {
    throw new ApiError(400, "The stay would end before it started. Check both dates.");
  }

  // ── THE BED LEGS ──
  const legById = new Map(a.bedStays.map((l) => [l.id, l]));
  const legEdits = input.legs ?? [];
  for (const e of legEdits) {
    if (!legById.has(e.id)) throw new ApiError(400, "That bed isn't part of this stay.");
    if (e.dailyCharge < 0) throw new ApiError(400, "A bed rate can't be negative.");
  }
  // ── THE BED DAY COUNTS ──
  //
  // Capping a bed takes nights OFF the bill. That is the point - the remainder
  // is raised as its own line - but it means every guard here is guarding
  // against an under-bill, which is the kind nobody complains about and nobody
  // notices either.
  const cappedTo = (e: { billedDays?: number | null }) => e.billedDays;
  for (const e of legEdits) {
    const d = cappedTo(e);
    if (d === undefined || d === null) continue;
    if (!Number.isInteger(d) || d < 0) {
      throw new ApiError(400, "A bed's billed days has to be a whole number, and can't be negative.");
    }
  }

  const firstLeg = a.bedStays[0];
  const lastLeg = a.bedStays[a.bedStays.length - 1];
  const admittedMoved = afterAdmittedAt.getTime() !== beforeAdmittedAt.getTime();

  // Moving the start date drags the first leg's start with it. Refused rather
  // than clamped where that would invert a leg: a stay that begins after the
  // patient was already moved out of the admitting ward is a transfer recorded
  // wrongly, and quietly reshaping the legs here would hide it.
  if (admittedMoved && firstLeg?.toDate && afterAdmittedAt >= firstLeg.toDate) {
    throw new ApiError(
      400,
      `That start date is after this patient was moved out of ${firstLeg.wardName}. Correct the transfer first.`
    );
  }
  if (afterDischargedAt && lastLeg && afterDischargedAt <= lastLeg.fromDate) {
    throw new ApiError(
      400,
      `That end date is before this patient was moved into ${lastLeg.wardName}. Correct the transfer first.`
    );
  }

  // A bed cannot be billed for more nights than the stay lasted. Checked
  // against the dates AS CORRECTED, because one save can move both - somebody
  // shortening a stay and capping a bed in the same breath must not be able to
  // leave the bed billing more days than the stay now has.
  const spanDays = stayDays(afterAdmittedAt, afterDischargedAt ?? now);
  for (const e of legEdits) {
    const d = cappedTo(e);
    if (d != null && d > spanDays) {
      throw new ApiError(
        400,
        `This stay is ${spanDays} day${spanDays === 1 ? "" : "s"} long. A bed can't be billed for more than that.`,
      );
    }
  }

  const legDayChanges = legEdits
    .filter((e) => e.billedDays !== undefined)
    .map((e) => ({ leg: legById.get(e.id)!, to: e.billedDays ?? null }))
    .filter((x) => (x.leg.billedDays ?? null) !== x.to);

  // ── THE RATES ──
  const beforeNurse = nursePerDayOf(a);
  const afterNurse = input.nursePerDay ?? beforeNurse;
  if (afterNurse < 0) throw new ApiError(400, "A nursing rate can't be negative.");

  const beforeBedRate = Number(a.dailyChargeAtAdmit.toString());
  // dailyChargeAtAdmit tracks the CURRENT bed, which is what a transfer already
  // writes to it. With no legs at all (a stay from before BedStay existed) it is
  // the only bed rate there is, and `bedRate` addresses it directly.
  const currentLegEdit = lastLeg ? legEdits.find((e) => e.id === lastLeg.id) : undefined;
  const afterBedRate = currentLegEdit
    ? currentLegEdit.dailyCharge
    : (a.bedStays.length === 0 && input.bedRate !== undefined ? input.bedRate : beforeBedRate);
  if (afterBedRate < 0) throw new ApiError(400, "A bed rate can't be negative.");

  const legChanges = legEdits
    .map((e) => ({ leg: legById.get(e.id)!, to: e.dailyCharge }))
    .filter((x) => Number(x.leg.dailyCharge.toString()) !== x.to);

  // Nothing actually moved. Don't write a ward note claiming somebody changed
  // the bill, and don't re-issue an invoice that would come back identical.
  const changed =
    admittedMoved ||
    (afterDischargedAt?.getTime() ?? null) !== (beforeDischargedAt?.getTime() ?? null) ||
    afterNurse !== beforeNurse ||
    afterBedRate !== beforeBedRate ||
    legChanges.length > 0 ||
    legDayChanges.length > 0;
  if (!changed) return;

  const fmt = (d: Date) =>
    d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const parts: string[] = [];
  if (admittedMoved) parts.push(`admitted ${fmt(beforeAdmittedAt)} → ${fmt(afterAdmittedAt)}`);
  if (afterDischargedAt && beforeDischargedAt && afterDischargedAt.getTime() !== beforeDischargedAt.getTime()) {
    parts.push(`discharged ${fmt(beforeDischargedAt)} → ${fmt(afterDischargedAt)}`);
  }
  for (const c of legChanges) {
    parts.push(
      `${bedLabel(c.leg.wardName, c.leg.bed?.bedNo)} ₹${Number(c.leg.dailyCharge.toString()).toFixed(2)}/day → ₹${c.to.toFixed(2)}/day`
    );
  }
  if (legChanges.length === 0 && afterBedRate !== beforeBedRate) {
    parts.push(`bed ₹${beforeBedRate.toFixed(2)}/day → ₹${afterBedRate.toFixed(2)}/day`);
  }
  if (afterNurse !== beforeNurse) {
    parts.push(`nursing ₹${beforeNurse.toFixed(2)}/day → ₹${afterNurse.toFixed(2)}/day`);
  }
  // Spelled out in nights rather than as a field name. This note is read by
  // whoever is asked why the bill changed, months later, and "billedDays: 3"
  // does not answer that question.
  for (const c of legDayChanges) {
    const bed = bedLabel(c.leg.wardName, c.leg.bed?.bedNo);
    const was = c.leg.billedDays == null ? "the stay's dates" : `${c.leg.billedDays} day(s)`;
    parts.push(
      c.to == null
        ? `${bed} billed days ${was} → the stay's dates`
        : `${bed} billed days ${was} → ${c.to} day(s)`,
    );
  }

  await withInvoiceInStep(
    actor, a.id, closed, ctx,
    async () => {
      await prisma.$transaction(async (tx) => {
        await tx.admission.update({
          where: { id: a.id },
          data: {
            admittedAt: afterAdmittedAt,
            ...(afterDischargedAt ? { dischargedAt: afterDischargedAt } : {}),
            // Only when they actually moved. Writing nursePerDay unconditionally
            // would turn "nobody has corrected this" (NULL, reads the hospital's
            // current fee) into a frozen ₹600 on every stay whose DATE somebody
            // fixed - so a later change to the standard rate would silently skip
            // exactly those stays.
            ...(afterNurse !== beforeNurse ? { nursePerDay: afterNurse.toFixed(2) } : {}),
            ...(afterBedRate !== beforeBedRate ? { dailyChargeAtAdmit: afterBedRate.toFixed(2) } : {}),
          },
        });
        for (const c of legChanges) {
          await tx.bedStay.update({ where: { id: c.leg.id }, data: { dailyCharge: c.to.toFixed(2) } });
        }
        for (const c of legDayChanges) {
          await tx.bedStay.update({ where: { id: c.leg.id }, data: { billedDays: c.to } });
        }
        if (admittedMoved && firstLeg) {
          await tx.bedStay.update({ where: { id: firstLeg.id }, data: { fromDate: afterAdmittedAt } });
        }
        await tx.admissionNote.create({
          data: {
            admissionId: a.id,
            kind: "NURSING",
            body:
              `Stay billing corrected: ${parts.join("; ")}.` +
              (input.reason?.trim() ? ` Reason: ${input.reason.trim()}` : "") +
              (closed ? " (after discharge - invoice re-issued)" : ""),
            authorId: actor.id,
          },
        });
      });
    },
    // Put the stay back exactly. The ward note stays: somebody DID attempt this,
    // and a refused correction on a claim is itself worth reading later.
    async () => {
      await prisma.$transaction(async (tx) => {
        await tx.admission.update({
          where: { id: a.id },
          data: {
            admittedAt: beforeAdmittedAt,
            // Every field back to what the row held, NULL included - a rollback
            // that leaves nursePerDay set has quietly frozen a rate the desk
            // never got to save.
            dischargedAt: beforeDischargedAt,
            nursePerDay: a.nursePerDay,
            dailyChargeAtAdmit: a.dailyChargeAtAdmit,
          },
        });
        for (const c of legChanges) {
          await tx.bedStay.update({ where: { id: c.leg.id }, data: { dailyCharge: c.leg.dailyCharge } });
        }
        // NULL included - a rollback that leaves a cap standing has quietly
        // shortened a bed the desk never got to save.
        for (const c of legDayChanges) {
          await tx.bedStay.update({ where: { id: c.leg.id }, data: { billedDays: c.leg.billedDays } });
        }
        if (admittedMoved && firstLeg) {
          await tx.bedStay.update({ where: { id: firstLeg.id }, data: { fromDate: firstLeg.fromDate } });
        }
      });
    },
  );

  await logAudit(actor, {
    action: "IPD_STAY_BILLING_CORRECTED", targetTable: "Admission", targetId: a.id,
    meta: {
      ipNumber: a.ipNumber,
      afterDischarge: closed,
      reason: input.reason?.trim() || null,
      before: {
        admittedAt: beforeAdmittedAt.toISOString(),
        dischargedAt: beforeDischargedAt?.toISOString() ?? null,
        bedRate: beforeBedRate,
        nursePerDay: beforeNurse,
        legs: legChanges.map((c) => ({ id: c.leg.id, dailyCharge: Number(c.leg.dailyCharge.toString()) })),
        legDays: legDayChanges.map((c) => ({ id: c.leg.id, billedDays: c.leg.billedDays })),
      },
      after: {
        admittedAt: afterAdmittedAt.toISOString(),
        dischargedAt: afterDischargedAt?.toISOString() ?? null,
        bedRate: afterBedRate,
        nursePerDay: afterNurse,
        legs: legChanges.map((c) => ({ id: c.leg.id, dailyCharge: c.to })),
        legDays: legDayChanges.map((c) => ({ id: c.leg.id, billedDays: c.to })),
      },
    },
    ...ctx,
  });

  // The day count and the running total both moved. The ward board, the
  // discharge desk and the insurance room are all looking at figures that are
  // now stale.
  await publishLive([TOPICS.IPD, TOPICS.RECEPTION, TOPICS.INSURANCE, TOPICS.ADMIN], EVENTS.ADMISSION_CORRECTED);
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
      doctor: { select: { name: true, specialization: true, department: true, registrationNo: true } },
      prescriptionUploads: {
        orderBy: { createdAt: "asc" },
        select: {
          title: true,
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
    title: string | null;
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

  // ── MEDICINES ADVISED ON DISCHARGE - THE LAST PRESCRIPTION, NOT THE STAY ──
  //
  // This used to fold in every prescription written during the admission and SUM
  // the quantities, under a heading that said "Medications Advised". So a stay
  // where an antibiotic was given on day one and stopped on day two printed it
  // as something to take home, at six days' quantity, next to the drug the
  // patient is actually meant to continue. A summary is read as instructions.
  //
  // The discharge advice is the LAST prescription the doctor wrote. Earlier ones
  // are what happened during the stay - that is Course in Hospital's job, and
  // the pharmacy bill's.
  // The doctor's own typed discharge advice wins over anything inferred. Only
  // when nobody has filled it in does the last prescription of the stay stand in
  // - which is a guess, and a guess should never override a written instruction.
  const typed = rxs.filter((r) => r.title === DISCHARGE_RX_TITLE);
  const lastRx = typed.length ? typed : rxs.length ? [rxs[rxs.length - 1]] : [];
  const medMap = new Map<string, { name: string; qty: number; dosage: string | null }>();
  for (const r of lastRx) {
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
 * WITHDRAWN. Nursing is no longer charged as a service on a stay.
 *
 * It was, until this was withdrawn: a flat per-day fee assigned to every
 * inpatient and derived (never a stored charge line), so it grew with the
 * length of stay exactly the way the bed does. ₹600 is the rate it was
 * withdrawn AT - the hospital's published figure ("Nursing charges … 600/-"
 * on the inpatient board at Balasamudram).
 *
 * The constant is kept, and so is every path that reads it, because STAYS
 * ALREADY BILLED FOR NURSING STILL CARRY IT. An invoice is a tax document: a
 * bill raised with a nursing line keeps that line, is re-issued with it when a
 * charge on it is corrected, and prints with it on the claim sheet. What
 * changed is that no NEW stay is given one - see hasNursingLine, which is how
 * every one of those paths decides, per stay, rather than by a date nobody
 * recorded.
 */
export const NURSE_FEE_PER_DAY = 600;

/**
 * Does this invoice line describe the withdrawn nursing fee?
 *
 * Matched on the description because that is all the line ever was - nursing is
 * derived at billing time and has no catalogue row and no id to match on. The
 * text is `buildIpdInvoiceLines`' own, written by this file and read back by
 * it, so the two cannot drift apart.
 */
export function isNursingLine(it: { description: string }): boolean {
  return it.description.trim().toLowerCase().startsWith("nursing care");
}

/**
 * WAS THIS STAY BILLED FOR NURSING? - the one question every nursing path now
 * asks, and it asks the stay's own invoice rather than a cutover date.
 *
 * A date would need recording somewhere and would be wrong for any stay that
 * straddled it. The invoice cannot be wrong: a stay was billed for nursing if
 * and only if its IPD bill says so. A stay still running has no invoice and so
 * carries no nursing, which is exactly the intent.
 */
export function hasNursingLine(
  invoices: { source: string; items: { description: string }[] }[],
): boolean {
  return invoices.some((i) => i.source === "IPD" && i.items.some(isNursingLine));
}

/**
 * What nursing costs per day ON THIS STAY - the hospital's rate unless somebody
 * has corrected it (Admission.nursePerDay).
 *
 * ONE function, called by all four places that price nursing: the running tab,
 * the discharge invoice, a post-discharge re-issue of that invoice, and the
 * printed claim bill. They read one figure or they drift, and the drift shows up
 * as a claim bill and a tax invoice that disagree about the same stay - found by
 * a TPA, months later, with nothing to say which was right.
 *
 * A stay nobody has touched has NULL here and reads the constant, which is why
 * the column needed no backfill.
 */
export function nursePerDayOf(a: { nursePerDay?: { toString(): string } | null }): number {
  return a.nursePerDay == null ? NURSE_FEE_PER_DAY : Number(a.nursePerDay.toString());
}

/** The full running tab: bed so far + every charge, with a live total. */
export async function admissionSheet(admissionId: string): Promise<{
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    /** Null while they are still in a bed. Editable - see correctStayBilling. */
    dischargedAt: string | null;
    wardName: string; bedNo: string; dailyCharge: string; gstRatePct: string;
    attendantName: string | null; attendantPhone: string | null; attendantRelation: string | null;
    /** Who settles this stay, decided at admission. Drives the banner the ward
     *  and the discharge desk read before they ask anyone for money. */
    payerType: string; insurer: string | null; policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string; registrationNo: string | null };
  };
  days: number;
  bedTotal: string;
  /**
   * Does a nursing line belong on this stay at all?
   *
   * FALSE on every stay admitted since the per-day nursing fee was withdrawn -
   * the screens and prints that render this sheet drop the row entirely.
   *
   * This is NOT the same as `nurseTotal` being "0.00", which is why it is its
   * own field. A stay from before the withdrawal can have nursing WAIVED to
   * ₹0 as a concession, and that stay must keep its row and its editable rate
   * so the desk can put the fee back. Withdrawn and waived look identical in
   * the money and are completely different in what the desk may do about it.
   */
  nursingApplies: boolean;
  /** Nursing care, days × nursePerDay. Derived, not a stored line. ₹0 unless
   *  the stay predates the fee's withdrawal - see nursingApplies. */
  nurseTotal: string;
  /** This stay's nursing rate - the hospital's, or a corrected one. */
  nursePerDay: string;
  /** The stay's chronology, oldest first. Append-only - see AdmissionNote. */
  notes: AdmissionNoteDTO[];
  charges: ChargeDTO[];
  chargesTotal: string;
  grandTotal: string;
  /** One row per bed occupied. Two rows means they were transferred. The id is
   *  what a rate correction addresses - each leg is priced on its own - and the
   *  dates are what lets a screen re-derive this leg's nights without asking. */
  legs: {
    id: string; wardName: string; bedNo: string; dailyCharge: string;
    from: string; to: string | null;
    /** Days BILLED. Normally the nights the dates give this leg; where a desk
     *  has capped the bed, the number they capped it to. */
    days: number;
    /** The cap itself, as stored. Null = billing the dates. The correction
     *  dialog needs the raw value to put back in the field. */
    billedDays: number | null;
    total: string; current: boolean;
  }[];
  /**
   * Nights of the stay no bed line covers, because a bed was capped and the
   * remainder has not been raised as its own charge yet.
   *
   * 0 on every ordinary stay. Above 0 it is a warning, not a total: those nights
   * are simply not billed, and whoever capped the bed meant to add a line for
   * them. Shown on the tab so a half-finished correction cannot sit there
   * quietly under-billing a stay.
   */
  uncoveredDays: number;
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
  /** THE SAME BILLS, PLUS THE ONES ALREADY PAID. What the running tab lists -
   *  see counterBillsForAdmission for why a settled bill must not disappear. */
  counterBills: CounterBillDTO[];
  counterPaidTotal: string;
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
      nursePerDay: true,
      attendantName: true, attendantPhone: true, attendantRelation: true,
      payerType: true, insurer: true, policyNo: true, memberId: true,
      bed: { select: { bedNo: true } },
      patient: { select: { id: true, displayId: true, fullName: true, age: true, gender: true, phone: true } },
      doctor: { select: { name: true, department: true, registrationNo: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, category: true, description: true, qty: true, unitPrice: true,
          gstRatePct: true, sourceRef: true, createdAt: true,
          addedBy: { select: { name: true } },
        },
      },
      // Read for one question only: was this stay billed for nursing? The fee
      // is withdrawn, so the tab shows a nursing line on a stay whose invoice
      // already carries one and on no other - the tab and the bill in the
      // family's hand have to say the same thing about the same stay.
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        select: { source: true, items: { select: { description: true } } },
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
      id: true, wardName: true, dailyCharge: true, fromDate: true, toDate: true,
      billedDays: true,
      bed: { select: { bedNo: true } },
    },
  });

  type StayRow = {
    id: string; wardName: string; dailyCharge: { toString(): string };
    fromDate: Date; toDate: Date | null; billedDays: number | null;
    bed: { bedNo: string } | null;
  };

  const until = a.dischargedAt ?? new Date();
  // What each leg BILLS - the nights its dates give it, or the number a desk
  // has capped it to. What it HELD is not sent: the correction dialog derives
  // it locally to seed its own box, and a second copy on the wire would be one
  // more thing that can disagree with the first.
  const sheetLegDays = billedLegDays(a.admittedAt, until, stays as StayRow[]);
  const legs = (stays as StayRow[]).map((st, i) => {
    const d = sheetLegDays[i];
    const daily = Number(st.dailyCharge.toString());
    return {
      id: st.id,
      wardName: st.wardName,
      bedNo: st.bed?.bedNo ?? "-",
      dailyCharge: daily.toFixed(2),
      from: st.fromDate.toISOString(),
      to: st.toDate?.toISOString() ?? null,
      days: d,
      billedDays: st.billedDays,
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
  // Every counter bill on the stay, paid or not - what the running tab lists.
  const counterBills = await counterBillsForAdmission(admissionId);

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

  // ── NURSING ── withdrawn as a service, so ₹0 on every stay that was not
  // already billed for it. One that WAS keeps its old rate here, because this
  // sheet is what the desk answers "what does this stay come to" from and the
  // invoice it must agree with has the line on it.
  //
  // `nursingApplies` below is what every screen and print reads to decide
  // whether to draw the row at all, rather than each of them re-deciding for
  // itself whether nursing still exists.
  const nursingApplies = hasNursingLine(a.invoices);
  const nursePerDay = nursingApplies ? nursePerDayOf(a) : 0;
  const nurseTotal = days * nursePerDay;
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
      dischargedAt: a.dischargedAt?.toISOString() ?? null,
      wardName: a.wardNameAtAdmit, bedNo: a.bed.bedNo,
      dailyCharge: a.dailyChargeAtAdmit.toString(), gstRatePct: a.gstRatePctAtAdmit.toString(),
      attendantName: a.attendantName, attendantPhone: a.attendantPhone, attendantRelation: a.attendantRelation,
      payerType: a.payerType, insurer: a.insurer, policyNo: a.policyNo, memberId: a.memberId,
      patient: a.patient, doctor: a.doctor,
    },
    days,
    bedTotal: bedTotal.toFixed(2),
    uncoveredDays: uncoveredStayDays(a.admittedAt, until, stays as StayRow[]),
    nursingApplies,
    nurseTotal: nurseTotal.toFixed(2),
    nursePerDay: nursePerDay.toFixed(2),
    notes: (a.noteEntries as NoteRow[]).map(toNoteDTO),
    chargesTotal: chargesTotal.toFixed(2),
    grandTotal: grandTotal.toFixed(2),
    charges,
    legs,
    advanceTotal: advanceTotal.toFixed(2),
    advances,
    outstandingBills: outstanding.bills,
    outstandingTotal: outstanding.totalDue,
    counterBills,
    /** What has already been collected at the pharmacy and lab windows. */
    counterPaidTotal: counterBills.reduce((s, b) => round2(s + Number(b.paid)), 0).toFixed(2),
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
        id: true, ipNumber: true, status: true, bedId: true, admittedAt: true,
        // The rate this stay has been billed at all along - needed to write the
        // opening leg for a stay admitted before legs existed. See below.
        wardNameAtAdmit: true, dailyChargeAtAdmit: true, gstRatePctAtAdmit: true,
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
    const closed = await tx.bedStay.updateMany({
      where: { admissionId: adm.id, toDate: null },
      data: { toDate: now },
    });

    // ── A STAY ADMITTED BEFORE LEGS OPENED WITH THE ADMISSION ──
    //
    // There was nothing to close, so the nights already spent in the first bed
    // have no row to be priced from - and the bill prices legs the moment any
    // exist. Without this, moving such a patient to ICU on day three would bill
    // ICU alone and give the first three days away.
    //
    // Written at `dailyChargeAtAdmit`, which is the rate that stay has actually
    // been billed at all along, rather than at the ward's rate today - a price
    // revision since admission must not reach back into nights already lived.
    if (closed.count === 0) {
      await tx.bedStay.create({
        data: {
          admissionId: adm.id,
          bedId: adm.bedId,
          wardName: adm.wardNameAtAdmit,
          dailyCharge: adm.dailyChargeAtAdmit,
          gstRatePct: adm.gstRatePctAtAdmit,
          fromDate: adm.admittedAt,
          toDate: now,
          movedById: actor.id,
        },
      });
    }

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

    // ON THE STAY'S OWN RECORD, not only in the audit log. A ward asking "when
    // did they move, and who moved them" reads the chronology; the audit log is
    // an admin screen they do not open. It also explains the second bed line on
    // the bill, which a family WILL ask about.
    await tx.admissionNote.create({
      data: {
        admissionId: adm.id,
        kind: "NURSING",
        body: `Transferred ${bedLabel(adm.wardNameAtAdmit, adm.bed?.bedNo)} → ${bedLabel(toBed.ward.name, toBed.bedNo)}`
          + (input.reason?.trim() ? `. Reason: ${input.reason.trim()}` : ""),
        authorId: actor.id,
      },
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
  /** `findFirst()` returns the whole row, so the declared shape says so - the
   *  slip's letterhead is the bill's, and that draws the uploaded logo. */
  hospital: { legalName: string; addressLine: string; city: string; state: string; stateCode: string; pincode: string; gstin: string | null; phone: string | null; logoDataUrl: string | null } | null;
  advance: { id: string; receiptNo: string | null; amount: string; mode: string; reference: string | null; takenAt: string; receivedBy: string };
  admission: {
    ipNumber: string; ward: string; bedNo: string; admittedAt: string;
    doctorName: string;
    /** The consultant's council number - this receipt is money taken from a
     *  patient, and those carry it. Null until it is on the roster. */
     doctorRegNo: string | null;
  };
  patient: { displayId: string; fullName: string; phone: string; age: number | null; gender: string | null; address: string | null };
  /**
   * What was held against this stay AS OF THIS RECEIPT - this deposit plus the
   * ones before it. NOT this receipt's value, and never printed as its total:
   * each slip totals its own amount, the way a bill does. Shown only as a note,
   * for the family and for the discharge counter.
   */
  totalAdvance: string;
  /** `totalAdvance` less this receipt: what was already held when it was written. */
  priorAdvance: string;
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
          doctor: { select: { name: true, registrationNo: true } },
          patient: { select: { displayId: true, fullName: true, phone: true, age: true, gender: true, address: true } },
        },
      },
    },
  });
  if (!a) throw new ApiError(404, "That advance receipt doesn't exist");

  // AS OF THIS RECEIPT, not as of now. Reprinting a slip must hand back the same
  // piece of paper it did the day it was issued - see heldAsOf.
  const siblings = await prisma.admissionAdvance.findMany({
    where: { admissionId: a.admission.id },
    select: { id: true, amount: true, createdAt: true },
  });
  const held = heldAsOf(
    (siblings as { id: string; amount: { toString(): string }; createdAt: Date }[])
      .map((x) => ({ id: x.id, amount: Number(x.amount.toString()), takenAt: x.createdAt.getTime() })),
    a.id,
  );

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
      doctorRegNo: a.admission.doctor.registrationNo,
    },
    patient: a.admission.patient,
    totalAdvance: held.total.toFixed(2),
    priorAdvance: held.prior.toFixed(2),
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

/** Where one line's own bill stands. Drafts have no bill yet and carry none. */
export type BillPaidStatus = "PAID" | "PART" | "DUE";

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
  /**
   * NOTHING HAS BILLED THIS YET.
   *
   * A stay accrues faster than its counters invoice it: the ward sends a
   * prescription down at 11 and the pharmacy raises the bill at 4, and a family
   * discharged at 1 used to be handed a sheet with none of it on. The item was
   * not disputed, not waived and not free - it was simply invisible, and the
   * hospital found out at the month end.
   *
   * So an un-invoiced item is printed as a line like any other and flagged here.
   * The sheet marks it, and `priced` below says whether its amount is real.
   */
  draft?: boolean;
  /**
   * For a line folded in off another counter's bill: where THAT bill stands.
   *
   * The stay sheet lists every item once whether or not it has been paid for,
   * so without this a medicine settled in cash at the window and one still owed
   * print identically. The desk needs to tell them apart at a glance, and the
   * family is entitled to see that what they already paid is on the sheet and
   * has been credited rather than quietly dropped.
   *
   * Absent on ward charges (they have no separate bill) and on drafts (nothing
   * has billed them at all).
   */
  paidStatus?: BillPaidStatus;
  /**
   * False when the line is a draft whose PRICE is not knowable yet.
   *
   * A prescribed medicine has no price until a pharmacist picks the batch it is
   * dispensed from - MRP lives on StockBatch, not on Medicine, and two batches
   * of the same strip can carry two prices. Such a line prints with its quantity
   * and a dash where the amount goes, and adds nothing to any total. Inventing a
   * figure would put a number on a bill that nobody has agreed to charge.
   */
  priced?: boolean;
}

export interface BillGroupDTO {
  title: string;
  lines: BillLineDTO[];
  total: string;
  /**
   * Break this section into date sub-headings.
   *
   * Investigations and pharmacy are read AS A COURSE - an assessor checking
   * whether a CRP was repeated, or a family asking what was given on the third
   * day, is looking for a date first and an item second. Ward and consultation
   * lines are not: they are one rate applied over the stay, and sub-heading
   * them by date would put a heading above every single row.
   */
  byDate: boolean;
}

/**
 * One of the OTHER counters' invoices whose lines appear on this bill.
 *
 * The stay sheet lists what was dispensed and what it cost, but a line on it is
 * not the document that billed it - the pharmacy's own invoice is. Naming those
 * invoices by number is what lets a family or an assessor ask for one, and what
 * makes "print all the bills" a request anybody can act on.
 */
export interface BillSourceDTO {
  receiptNo: string; source: string; date: string;
  total: string; paid: string; status: BillPaidStatus;
}

/** One row of the bill's Payment Details table. */
export interface BillPaymentDTO {
  /** Deposit receipt, or the invoice the money landed against. */
  invoiceNo: string;
  date: string;
  mode: string;
  amount: string;
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
    /** "2ND FLOOR/PICU/203" - floor, ward and bed as one readable string. */
    roomInfo: string;
    /** DISCHARGE · LAMA · EXPIRED … - how the stay ended, printed as stated. */
    dischargeType: string;
    /** The consultant's letters, as they appear under their name. */
    qualification: string | null;
    specialization: string | null;
    /** Their council registration number. A money receipt given to a patient
     *  must carry it - see the IMC Professional Conduct Regulations 2002. */
    registrationNo: string | null;
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
  /**
   * How much of `gross` comes from lines nothing has invoiced yet.
   *
   * INCLUDED IN THE TOTALS, not held apart. A bill that quietly leaves out what
   * the pharmacy has not got round to billing understates what the stay cost,
   * and the desk collects the smaller number. So the draft lines count - and
   * this is what lets the sheet say how much of the figure is still provisional
   * rather than presenting it as settled fact.
   */
  draftTotal: string;
  /** Lines with no price yet (a prescribed medicine with no batch). */
  draftUnpricedCount: number;
  /**
   * Money ALREADY TAKEN at a counter: at the pharmacy and lab windows on bills
   * that are listed above, and at the discharge desk against the stay's own
   * bill (deposits excepted - they are `advance`). Subtracted from the net,
   * exactly like an advance is - it is the same thing: the stay's money,
   * already in a drawer.
   */
  counterPaid: string;
  /**
   * Every rupee received against this stay, itemised - deposits taken at the
   * desk and payments made on its counter bills, oldest first.
   *
   * The totals block can only say how much came in. This says WHEN, in WHAT,
   * and against which receipt, which is the difference between a bill a family
   * can check and one they have to take on trust.
   */
  payments: BillPaymentDTO[];
  /** The other counters' bills folded in above, by invoice number. */
  sourceBills: BillSourceDTO[];
}

/**
 * JUST THE MEDICINE'S NAME, for the stay bill.
 *
 * A pharmacy line's description carries its whole dispensing story:
 * "CREMAFFIN syP 225Ml (unit) · Batch 76250", "Dolo 650 Tablet · 20 tablets
 * @ ₹2 (pack of 10)". All of it is right on the PHARMACY'S OWN invoice, which
 * is the document somebody checking a batch or a pack price actually opens.
 *
 * Repeated on the stay bill it is noise in a narrow column - and worse, the
 * batch number then printed TWICE on the same row, once inside the description
 * and once in the batch column beside it. The stay bill answers "what was
 * dispensed and what did it cost"; the name and the money do that.
 */
const medicineNameOnly = (description: string) => description.split(" · ")[0].trim();

/**
 * The names a billed pharmacy line answers to, when a ward prescription is
 * checked against it.
 *
 * A single-unit item is invoiced as "NAME (unit) · Batch …" (see dispense), so
 * medicineNameOnly leaves "NAME (unit)" while the prescription says "NAME".
 * Compared as-is the two never matched, and a prescription with no invoice of
 * its own came back as unbilled medicine the invoice had already charged.
 * Both forms are offered, lower-cased: adding a key can only catch a match the
 * full name already missed, never lose one it found.
 */
export function medicineMatchKeys(billedName: string): string[] {
  const name = billedName.trim().toLowerCase();
  const bare = name.replace(/\s*\([^()]*\)$/, "").trim();
  return bare && bare !== name ? [name, bare] : [name];
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
      wardNameAtAdmit: true, dailyChargeAtAdmit: true, nursePerDay: true,
      payerType: true, insurer: true, policyNo: true,
      // Floor and ward category build the "Room Info" line the bill prints as
      // 2ND FLOOR/PICU3/203 - one string the desk reads back to a family.
      bed: { select: { bedNo: true, ward: { select: { name: true, floor: true, category: true } } } },
      doctor: { select: { name: true, department: true, specialization: true, qualification: true, registrationNo: true } },
      patient: { select: { fullName: true, displayId: true, age: true, gender: true, phone: true } },
      charges: {
        orderBy: { createdAt: "asc" },
        select: { category: true, description: true, qty: true, unitPrice: true, sourceRef: true, createdAt: true },
      },
      bedStays: {
        orderBy: { fromDate: "asc" },
        select: { wardName: true, dailyCharge: true, fromDate: true, toDate: true, billedDays: true, bed: { select: { bedNo: true } } },
      },
      labTests: {
        // Only tests no invoice has billed yet. A test that HAS been invoiced
        // arrives below as an invoice line instead - counting it from both
        // sources would bill the insurer twice for one sample.
        where: { invoiceItems: { none: {} } },
        orderBy: { createdAt: "asc" },
        select: { testName: true, priceAtOrder: true, createdAt: true, orderGroupId: true, catalog: { select: { code: true } } },
      },
      // Each deposit is a ROW in the bill's Payment Details table, not just a
      // number in the totals - a family that paid twice expects to see twice.
      advances: { select: { id: true, receiptNo: true, amount: true, mode: true, createdAt: true } },
      // ── MEDICINES THE WARD ASKED FOR THAT NOBODY HAS BILLED ──
      // Only prescriptions with no invoice behind them: once the pharmacy bills
      // one, it arrives below as an invoice line and counting it from both
      // sources would charge the family twice for the same strip.
      //
      // THE DISCHARGE ADVICE IS NOT ONE OF THEM. "Medications advised" on the
      // discharge summary is what the patient is told to TAKE AT HOME - a
      // prescription to fill after they leave, not stock this hospital handed
      // over. It is stored as a PrescriptionUpload because that is what it is
      // (see setDischargeMedicines), and it has no invoice behind it because
      // nobody dispensed it - which is exactly the shape the filter above was
      // written to catch, so every advised drug was landing under PHARMACY
      // CHARGES and being charged for at the counter. The family paid for
      // tablets they were only told to go and buy.
      //
      // Matched on the title, the same marker setDischargeMedicines writes and
      // getDischargeMedicines reads back. Spelt as an OR rather than `not`
      // because a prescription with NO title at all is an ordinary ward one and
      // must still be billed.
      prescriptionUploads: {
        where: {
          invoices: { none: {} },
          OR: [{ title: null }, { title: { not: DISCHARGE_RX_TITLE } }],
        },
        orderBy: { createdAt: "asc" },
        select: {
          createdAt: true,
          items: { select: { medicineName: true, qty: true, dosage: true, medicineId: true } },
        },
      },
      invoices: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        select: {
          receiptNo: true, source: true, createdAt: true, payer: true,
          discountAmount: true, cgstAmount: true, sgstAmount: true,
          // With the lines, fixes what a counter bill's discount came to - see
          // counterDiscount below.
          taxableAmount: true,
          // Needed to know whether a folded-in counter bill has ALREADY been
          // paid. Without this the sheet adds a paid pharmacy bill into its
          // gross and then asks the family for it a second time.
          totalAmount: true,
          // `reference` tells a carried-over deposit apart from money taken at
          // the desk; refunds net the latter. See takenOnStayBill.
          payments: { select: { amount: true, mode: true, reference: true, createdAt: true } },
          refunds: { select: { amount: true } },
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

  // ── ONCE THE STAY'S FINAL BILL IS RAISED, THIS SHEET IS WHAT WAS BILLED ──
  //
  // While the patient is in a bed, a test the lab has not invoiced or a ward
  // medicine the pharmacy has not billed is still on its way to a bill, so it
  // prints and counts (see the draft lines below). After discharge nothing is on
  // its way any more: the family settled the stay bill, and a test nobody
  // invoiced then kept this sheet showing a balance on a stay that had been
  // paid in full - weeks later, on every reprint. So a finalised stay carries
  // invoiced lines only, which is also what its tax invoices say. The owner's
  // call, 28 Sep 2026. A cancelled stay bill does not count: the query drops it,
  // and the drafts come back with the reopened stay.
  const finalised = a.invoices.some((i) => i.source === "IPD");
  const m2 = (n: number) => round2(n).toFixed(2);

  const groups: BillGroupDTO[] = [];
  const push = (title: string, lines: BillLineDTO[], byDate = false) => {
    if (!lines.length) return;
    groups.push({ title, lines, byDate, total: m2(lines.reduce((s, l) => round2(s + Number(l.amount)), 0)) });
  };

  // ── WARD ── one line per LEG, so a General to ICU transfer prints as two rows
  // at two rates. An insurer paying an ICU entitlement has to see which nights
  // were actually ICU, and one averaged line cannot tell them.
  const billLegDays = billedLegDays(a.admittedAt, end, a.bedStays);
  const wardLines: BillLineDTO[] = a.bedStays.length
    ? a.bedStays.map((st, i) => {
        const d = billLegDays[i];
        const rate = num(st.dailyCharge);
        return {
          // THE DAY THE PATIENT MOVED INTO THIS BED, not null.
          //
          // Every other hospital-services line carries its date, and a bed leg
          // without one printed as the only undated row in the section - on a
          // stay with a transfer, the two ward rows then gave no way to tell
          // which nights were which. The leg's own start date says it.
          date: st.fromDate.toISOString(),
          issueNo: null, code: null,
          // NAMED, AND IN THE WARD'S OWN WORDS.
          //
          // This printed the stored bed id straight out of the column -
          // "General Ward - GW-01" - which says the ward twice on any bed whose
          // id carries its ward as a prefix, and reads as a database row on the
          // one document a family and a TPA both keep. `bedLabel` is the single
          // definition of how a bed reads to a person ("General Ward BED 1");
          // every screen and the GST invoice already use it, and this sheet was
          // the last place still spelling it its own way.
          //
          // "Bed charges ·" because the row sits under HOSPITAL SERVICES beside
          // "Nursing Charges" - without it, the first line of the bill is a
          // place rather than a charge.
          description: `Bed charges · ${bedLabel(st.wardName, st.bed?.bedNo)}`,
          batchNo: null, expiry: null,
          rate: m2(rate), qty: d, amount: m2(rate * d),
        };
      })
    : [{
        // No bed-stay rows to date it from, so the stay's own start is the
        // honest answer - that is the day the bed began to be charged.
        date: a.admittedAt.toISOString(),
        issueNo: null, code: null,
        // Same label as the leg rows above - a stay with no BedStay row must not
        // print its bed a second way.
        description: `Bed charges · ${bedLabel(a.wardNameAtAdmit, a.bed?.bedNo)}`,
        batchNo: null, expiry: null,
        rate: m2(num(a.dailyChargeAtAdmit)), qty: days, amount: m2(num(a.dailyChargeAtAdmit) * days),
      }];
  // NOT pushed yet - the bed, the nursing and the ward's services print as one
  // HOSPITAL SERVICES block, which is how the bill this format copies reads.
  // They are assembled together below, once the services are known.

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

  // ── THE OTHER COUNTERS' BILLS, ON EVERY STAY ──
  //
  // Pharmacy and lab raise their own invoices against the stay and settle at
  // their own counters. This used to fold them in for a CASHLESS CLAIM only, on
  // the reasoning that a self-paying family pays three counters and gets three
  // bills, so the stay sheet did not need to repeat them.
  //
  // That reasoning was wrong in the one place it mattered. The family asks the
  // discharge desk "what do we owe", and the desk was answering off a sheet that
  // showed the bed and the nursing and nothing else - no medicines, no
  // investigations. The pharmacy bill was real and payable and simply not on the
  // document anyone was reading. So both counters' lines are folded in for a
  // self-paying stay too, and the sheet is now the whole stay rather than the
  // part of it the ward happened to raise.
  //
  // The separate invoices still EXIST and are untouched - this changes what the
  // stay sheet SHOWS, not what was billed or where it was paid.
  //
  // AND MONEY ALREADY TAKEN AGAINST THEM IS SUBTRACTED AT THE BOTTOM.
  //
  // Folding a counter bill into the gross without accounting for what was paid
  // on it charges the family twice: once in cash at the pharmacy window, and
  // again in the Net Payable at discharge. `counterPaid` below is that money,
  // and every line carries the status of the bill it came off, so the sheet
  // reads as a running account - every item listed once, each marked paid or
  // due, and only the difference asked for.
  let counterPaid = 0;
  // THE COUNTERS' OWN DISCOUNTS AND GST. Their lines are folded in below at the
  // line amount - before that bill's discount and without its tax - while what
  // was paid on them is the bill's TOTAL. Without these the sheet asked for a
  // taxed pharmacy bill short by its GST, and on a stay paid in full printed a
  // Net Amount smaller than the money received against it.
  let counterDiscount = 0;
  let counterGst = 0;
  // Paise the windows left uncollected on bills that read as PAID - see below.
  let paiseShort = 0;
  const sourceBills: BillSourceDTO[] = [];
  {
    const SECTION_OF: Record<string, string> = {
      PHARMACY: "PHARMACY", LAB: "INVESTIGATIONS", OTHER: "SERVICES", CONSULTATION: "SERVICES",
    };
    for (const inv of a.invoices) {
      // The IPD invoice is this bill, not an input to it - its lines are the
      // ones above. But what the discharge desk TOOK against it is money
      // received like any counter's, and comes off with theirs. Without this a
      // family who settled the balance in cash was shown that cash as still
      // owed. Deposits are left out: `advance` below already has them.
      if (inv.source === "IPD") {
        counterPaid = round2(counterPaid + takenOnStayBill(
          inv.payments.map((p) => ({ amount: num(p.amount), reference: p.reference })),
          inv.refunds.map((r) => ({ amount: num(r.amount) })),
        ));
        continue;
      }

      const paid = inv.payments.reduce((s, p) => round2(s + num(p.amount)), 0);
      const total = num(inv.totalAmount);
      counterPaid = round2(counterPaid + paid);
      // The discount this bill ACTUALLY applied is whatever its printed lines
      // add up to above its taxable value - rounding included - so lines, less
      // discount, plus GST lands on the bill's own total to the paisa.
      const printed = inv.items.reduce((s, it) => round2(s + num(it.amount)), 0);
      counterDiscount = round2(counterDiscount + round2(printed - num(inv.taxableAmount)));
      counterGst = round2(counterGst + num(inv.cgstAmount) + num(inv.sgstAmount));
      // A bill the window left a paisa short on reads as PAID (see `status`),
      // and must not come back as a balance here either. Per bill, so three
      // such bills on one stay do not add up to a debt none of them has.
      const short = round2(total - paid);
      if (short > 0 && short <= 0.01) paiseShort = round2(paiseShort + short);
      // PART only where something was paid AND something is still owed - a
      // rounding-sized remainder must not print as a debt.
      const status: BillPaidStatus =
        paid >= total - 0.01 ? "PAID" : paid > 0.01 ? "PART" : "DUE";
      sourceBills.push({
        receiptNo: inv.receiptNo, source: inv.source,
        date: inv.createdAt.toISOString(),
        total: m2(total), paid: m2(paid), status,
      });

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
            // Trimmed to the name on a pharmacy line only. A lab or service
            // description is already just what it is and has no tail to lose.
            description: section === "PHARMACY" ? medicineNameOnly(it.description) : it.description,
            batchNo: it.batch?.batchNo ?? null,
            // MM/YYYY - how an expiry is printed on a strip and how an assessor
            // checking a pharmacy line expects to read it. A full timestamp in a
            // 8%-wide column would just be truncated.
            expiry: it.batch?.expiryDate
              ? `${String(it.batch.expiryDate.getMonth() + 1).padStart(2, "0")}/${it.batch.expiryDate.getFullYear()}`
              : null,
            rate: m2(num(it.unitPrice)), qty: it.qty, amount: m2(num(it.amount)),
            paidStatus: status,
          },
        ]);
      }
    }
  }

  // ── HOSPITAL SERVICES ── the bed, the nursing and everything the ward booked
  // against the stay, under one heading with one subtotal. Room rent, PICU,
  // oxygen, a syringe pump and the MRD fee are all "what the hospital did",
  // and a policy is read against that subtotal as a whole.
  //
  // NURSING IS WITHDRAWN, and this sheet prints it only for a stay that was
  // actually billed for it. It is derived rather than stored, so nothing in the
  // invoice rows below would have stopped it printing on a stay that never paid
  // it - and a claim sheet carrying a line the tax invoice does not is the
  // exact disagreement an assessor finds months later. See hasNursingLine.
  const nurseRate = hasNursingLine(a.invoices) ? nursePerDayOf(a) : 0;
  push("HOSPITAL SERVICES", [
    ...wardLines,
    ...(nurseRate > 0
      ? [{
          // Nursing accrued from the moment the patient was in a bed, so the
          // stay's start dates it - the same day the first bed line carries.
          date: a.admittedAt.toISOString(),
          issueNo: null, code: null,
          description: "Nursing Charges",
          batchNo: null, expiry: null,
          rate: m2(nurseRate), qty: days, amount: m2(nurseRate * days),
        }]
      : []),
    ...(bySection.get("SERVICES") ?? []),
  ]);

  push("CONSULTATION CHARGES", bySection.get("DOCTOR VISITING CHARGES") ?? []);

  // ── Investigations ── the lab's own rows plus anything the ward booked as an
  // investigation on the tab. The order id doubles as the issue number, so one
  // sample reads as one issue exactly as the lab raised it.
  //
  // Every row here is a test NO invoice has billed (see the query filter), so
  // they are all drafts. They are priced, though - a lab test's price is fixed
  // when it is ordered and snapshotted onto the row, so the amount is the real
  // one and not a guess.
  const labLines: BillLineDTO[] = (finalised ? [] : a.labTests).map((t) => ({
    date: t.createdAt.toISOString(),
    issueNo: t.orderGroupId ? t.orderGroupId.slice(-8).toUpperCase() : null,
    code: t.catalog?.code ?? null,
    description: t.testName,
    batchNo: null, expiry: null,
    rate: m2(num(t.priceAtOrder)), qty: 1, amount: m2(num(t.priceAtOrder)),
    draft: true, priced: true,
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
  push("LAB INVESTIGATION CHARGES", [
    ...labLines.filter((l) => !invoicedInvestigations.has(l.description.trim().toLowerCase())),
    ...(bySection.get("INVESTIGATIONS") ?? []),
  ], true);

  // ── MEDICINES ORDERED BUT NOT YET BILLED ──
  //
  // A ward prescription that the pharmacy has not invoiced. It is the commonest
  // gap on a discharge bill, because the prescription is written on the ward and
  // the bill is raised at a counter downstairs - the patient can be discharged
  // in between.
  //
  // PRICED ONLY WHERE A PRICE HONESTLY EXISTS. MRP lives on StockBatch, not on
  // Medicine, because two batches of the same strip can carry two prices - so an
  // item nobody has dispensed yet has no price at all. Where the prescription
  // names a medicine in the master, the batch the pharmacy would dispense NEXT
  // prices the line; where it does not (reception transcribed handwriting that
  // matches nothing in stock) the line prints with its quantity and no amount,
  // and contributes nothing to any total.
  //
  // TWO THINGS HERE MUST MATCH THE PHARMACY COUNTER EXACTLY, because this figure
  // now counts towards the bill total:
  //
  //   FEFO, not newest. The counter dispenses the earliest expiry with stock on
  //   it, so that is the batch whose price the family will actually be charged.
  //   Pricing off the newest batch quotes one figure and bills another.
  //
  //   PER UNIT, not per pack. StockBatch.mrp is the price of the whole strip as
  //   printed on it; a prescription is written in tablets. Using the pack price
  //   as the tablet price is the 15x overcharge perUnitPrice exists to prevent -
  //   see the note on pharmacy.service's unitMrp.
  const unbilledItems = (finalised ? [] : a.prescriptionUploads).flatMap((u) =>
    u.items.map((it) => ({ ...it, at: u.createdAt }))
  );
  const medIds = [...new Set(unbilledItems.map((i) => i.medicineId).filter(Boolean) as string[])];
  const unitPriceOf = new Map<string, number>();
  if (medIds.length) {
    const batches = await prisma.stockBatch.findMany({
      where: { medicineId: { in: medIds }, quantity: { gt: 0 } },
      orderBy: { expiryDate: "asc" },
      select: { medicineId: true, mrp: true, packSize: true },
    });
    // Ordered earliest-expiry-first, so the FIRST row seen for a medicine is the
    // one FEFO would pick and later batches must not overwrite it.
    for (const b of batches) {
      if (!unitPriceOf.has(b.medicineId)) {
        unitPriceOf.set(b.medicineId, perUnitPrice(num(b.mrp), b.packSize));
      }
    }
  }

  // The invoice wins over the prescription where both name the same medicine.
  //
  // `prescriptionUploadId` normally ties them together and the query above
  // already drops any prescription the pharmacy has billed. But a counter that
  // bills a ward patient WITHOUT picking up the prescription - a walk-in-style
  // sale keyed straight against the stay - leaves the link null, and that strip
  // would then appear twice: once as a billed invoice line and once as a draft.
  // On a bill whose drafts count towards the total, that is money charged twice.
  // Same belt as the investigations above, and for the same reason.
  //
  // The commonest way to get here is a ward dispense whose invoice failed after
  // its prescription was filed: the retry bills the strip, and the first
  // attempt's prescription is left with no invoice. Matched on medicineMatchKeys
  // because a single-unit line is invoiced as "NAME (unit)".
  const invoicedMedicines = new Set(
    (bySection.get("PHARMACY") ?? []).flatMap((l) => medicineMatchKeys(l.description))
  );
  const draftMedLines: BillLineDTO[] = unbilledItems
    .filter((it) => !invoicedMedicines.has(it.medicineName.trim().toLowerCase()))
    .map((it) => {
      const rate = it.medicineId ? unitPriceOf.get(it.medicineId) : undefined;
      const priced = rate != null && rate > 0;
      return {
        date: it.at.toISOString(),
        issueNo: null, code: null,
        // Name only, same as the billed pharmacy lines above - the dosage is on
        // the prescription, and this column is not where anyone reads it.
        description: it.medicineName,
        batchNo: null, expiry: null,
        rate: priced ? m2(rate!) : "0.00",
        qty: it.qty,
        amount: priced ? m2(rate! * it.qty) : "0.00",
        draft: true, priced,
      };
    });

  push("PHARMACY CHARGES", [...(bySection.get("PHARMACY") ?? []), ...draftMedLines], true);

  // ── The money block ──
  //
  // The bill number comes from the IPD invoice specifically - the stay's own
  // document. Pharmacy and lab invoices are folded into the lines above, but
  // they are not what this sheet IS, and their receipt numbers must never end up
  // in the "Bill No" box an insurer files it under.
  //
  // The discount and the GST are the stay's PLUS the counters' - their lines are
  // on this sheet, so their tax is too, and the Total GST row then matches the
  // tax invoices the pharmacy issued for the same strips.
  const gross = groups.reduce((s, g) => round2(s + Number(g.total)), 0);
  const inv = a.invoices.find((i) => i.source === "IPD");
  const discount = round2(num(inv?.discountAmount) + counterDiscount);
  const gst = round2(num(inv?.cgstAmount) + num(inv?.sgstAmount) + counterGst);
  const netBill = round2(gross - discount + gst);
  const advance = a.advances.reduce((s, x) => round2(s + num(x.amount)), 0);
  // A rounding-sized remainder is not a debt - the same paisa `sourceBills`
  // already reads as PAID. Taken off per counter bill above, and once more here
  // for the stay's own bill, so a settled stay never prints "Balance 0.01".
  const due = round2(netBill - advance - counterPaid - paiseShort);

  // How much of the figure above nobody has invoiced yet, and how many lines
  // could not be priced at all. The sheet prints both: a total that silently
  // mixes billed and unbilled money is worse than one that says which is which.
  const allLines = groups.flatMap((g) => g.lines);
  const draftTotal = allLines
    .filter((l) => l.draft)
    .reduce((s, l) => round2(s + Number(l.amount)), 0);
  const draftUnpricedCount = allLines.filter((l) => l.draft && !l.priced).length;

  // ── PAYMENT DETAILS ── deposits and counter payments as one chronological
  // list. Both are money this stay has received; the family does not
  // distinguish between the two and the bill should not make them.
  const payments: BillPaymentDTO[] = [
    ...a.advances.map((x) => ({
      invoiceNo: x.receiptNo ?? "ADVANCE",
      date: x.createdAt.toISOString(),
      mode: String(x.mode),
      amount: m2(num(x.amount)),
      at: x.createdAt.getTime(),
    })),
    ...a.invoices.flatMap((i) =>
      i.payments
        // The deposit, carried onto the stay's invoice at discharge, is already
        // the row above with its own slip number. Listed again it made the
        // column add up to more than was ever received.
        .filter((p) => !isAdvanceAdjustment(p.reference))
        .map((p) => ({
          invoiceNo: i.receiptNo,
          date: p.createdAt.toISOString(),
          mode: String(p.mode),
          amount: m2(num(p.amount)),
          at: p.createdAt.getTime(),
        }))
    ),
  ]
    .sort((x, y) => x.at - y.at)
    // `at` was only ever a sort key; it is not part of the printed row.
    .map(({ at: _at, ...row }) => row);

  /** "2ND FLOOR/PICU/203" - blank segments dropped rather than left as //. */
  const roomInfo = [a.bed?.ward?.floor, a.bed?.ward?.name ?? a.wardNameAtAdmit, a.bed?.bedNo]
    .filter((x) => x && String(x).trim())
    .join("/");

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
      roomInfo: roomInfo || a.wardNameAtAdmit,
      // Printed as the stay actually ended. A LAMA or an EXPIRED discharge is
      // not "DISCHARGE", and a bill that says otherwise is a false record of a
      // thing an insurer and a family both remember clearly.
      dischargeType: a.status,
      qualification: a.doctor.qualification,
      specialization: a.doctor.specialization,
      registrationNo: a.doctor.registrationNo,
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
    // Advance AND counter money both come off. Both are the stay's own money,
    // already in the drawer; the only difference is which window took it.
    netPayable: m2(due > 0.01 ? due : 0),
    draftTotal: m2(draftTotal),
    draftUnpricedCount,
    counterPaid: m2(counterPaid),
    payments,
    sourceBills: [...sourceBills].sort((x, y) => x.date.localeCompare(y.date)),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE IP SERVICES BILL - the same stay, read the way a self-paying family reads it
   ════════════════════════════════════════════════════════════════════════════

   The IP bill above is unchanged and stays exactly what it is: one gross figure,
   the discount off the bottom, and a number for a TPA to assess. This is a
   SECOND document in the same format, for the one conversation that sheet
   cannot hold - the discount conversation at the discharge counter.

   What it does differently, and why:

     IT BILLS THE HOSPITAL'S OWN SERVICES AND NOTHING ELSE. The bed, the ward's
     charges, the consultant's visits - those are the hospital's price to set,
     and the only charges a discount may touch. Medicines are sold at the MRP
     printed on the strip and tests carry the lab's rate, so a discount on those
     gives away somebody else's margin.

     THE PHARMACY AND THE LAB ARE NOT REPRINTED HERE. Both counters raise their
     own invoice and hand it over at the window during the stay. Folding every
     strip and every test back onto this sheet gave the family a second copy of
     a bill they were already holding, ran a long stay onto extra pages, and
     started the argument at the medicine line that the split was meant to end.
     Their lines, their block totals and their counter invoices are all left
     off, and what is asked for at the foot of the page is the services figure
     alone.

     WHAT IS ALREADY PAID AGAINST THE STAY IS TAKEN OFF, and the deposit comes
     off after it. The IP bill subtracts the deposit and the counters and stops
     there; this sheet has to answer "what do we owe now" on the services block,
     so money taken against the stay's own invoice is credited too.

     A LEFT-OVER DEPOSIT IS NOT DECLARED REFUNDABLE WHILE THE COUNTERS ARE OWED.
     The pharmacy and the lab are off this page but not out of the stay, and
     their dues were absorbing the deposit before any refund line was reached.
     `counterDue` below keeps that true, so the refund printed here is the same
     figure it was when all three blocks were on the paper.

   WHO IT IS FOR, and this is a gate rather than a preference: a SELF-PAYING
   stay, or one the insurer refused and that has been moved onto the family.
   Printing a discounted "pay this now" sheet for a cashless stay asks a family
   for money an insurer is carrying, and the desk that prints it will collect it.
   So the service refuses rather than trusting the screen not to link it.
   ══════════════════════════════════════════════════════════════════════════ */

/** Why this stay may be billed on this sheet - or why it may not. */
export type SelfPayBasis = "SELF_PAY" | "INSURANCE_REFUSED" | "NONE";

export interface IpServicesGroupDTO extends BillGroupDTO {
  /** Which of the three blocks this section is added into. */
  bucket: IpBillBucket;
  /** True on the hospital's own services - the only ones a discount touches. */
  discountable: boolean;
  /**
   * NO PER-SECTION PAID FIGURE, deliberately.
   *
   * Money arrives against a COUNTER BILL, not against a printed heading, and a
   * block can be spelt over two sections - the ward's investigation lines and
   * the lab's own both land in LAB. Splitting one payment across them would need
   * an attribution nothing records, and a figure per heading that does not add
   * up to the block is worse than no figure at all. Paid-vs-due is answered per
   * BLOCK, in the summary grid, and per LINE by `paidStatus`.
   */
}

/** One block of the printed money table. Strings, like every other figure here. */
export interface IpBillBlockDTO {
  gross: string; discount: string; net: string; paid: string; due: string; settled: boolean;
}

export interface IpServicesMoneyDTO {
  services: IpBillBlockDTO;
  /**
   * NO LAB OR PHARMACY BLOCK, and that is the shape of the document rather than
   * an omission. This sheet bills the hospital's own services; the medicines and
   * the tests are billed at their own counters on their own invoices, and
   * reprinting them here handed a family a second copy of a bill already in
   * their hand. See the note above `ipServicesBillData`.
   */
  gross: string;
  discount: string;
  /** Agreed but with no services left to come off - printed as a caveat, never
   *  quietly spread onto the medicines. See lib/ip-services-bill. */
  discountUnapplied: string;
  gst: string;
  netBill: string;
  paidTotal: string;
  dueBeforeAdvance: string;
  advance: string;
  advanceApplied: string;
  netPayable: string;
  /**
   * The deposit left over ONCE THE COUNTERS THIS SHEET DOES NOT PRINT ARE
   * SATISFIED. The pharmacy and the lab are off the page but not out of the
   * stay, and their dues were absorbing the deposit long before any refund line
   * appeared. Held back rather than declared: a refund printed over an unpaid
   * pharmacy bill is money out of the drawer.
   */
  refundDue: string;
}

export interface IpServicesBillDTO extends Omit<DetailedBillDTO, "groups"> {
  groups: IpServicesGroupDTO[];
  /** False means the sheet must not be printed - see the note above. */
  eligible: boolean;
  basis: SelfPayBasis;
  /** One sentence the sheet prints, or refuses with. */
  eligibilityNote: string;
  money: IpServicesMoneyDTO;
}

/** Which block a counter's invoice was raised at. Mirrors the section mapping. */
const BUCKET_OF_SOURCE: Record<string, IpBillBucket> = {
  PHARMACY: "PHARMACY", LAB: "LAB", CONSULTATION: "SERVICES", OTHER: "SERVICES",
};

export async function ipServicesBillData(admissionId: string): Promise<IpServicesBillDTO> {
  // The lines, the header and the counter bills are IDENTICAL to the IP bill's -
  // this is the same stay, and two functions assembling it two ways is how a
  // family ends up holding two sheets that disagree. Only the money block below
  // and the eligibility gate are this document's own.
  const base = await detailedBillData(admissionId);

  const [stay, claims] = await Promise.all([
    prisma.admission.findUnique({
      where: { id: admissionId },
      select: {
        payerType: true,
        advances: { select: { receiptNo: true, amount: true, mode: true, createdAt: true } },
        invoices: {
          where: { status: { not: "CANCELLED" } },
          // Newest first, so the stay invoice picked below is the one the IP
          // bill picks.
          orderBy: { createdAt: "desc" },
          select: {
            source: true, payer: true, receiptNo: true,
            discountAmount: true, cgstAmount: true, sgstAmount: true,
            payments: { select: { amount: true, mode: true, reference: true, createdAt: true } },
            refunds: { select: { amount: true } },
          },
        },
      },
    }),
    prisma.insuranceClaim.findMany({
      where: { admissionId },
      select: { status: true },
    }),
  ]);
  if (!stay) throw new ApiError(404, "Admission not found");

  const num = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));
  const m2 = (n: number) => round2(n).toFixed(2);

  // ── WHO THIS SHEET MAY BE PRINTED FOR ──
  //
  // A converted stay needs no second test: revertBillsToSelfPay flips payerType
  // to SELF_PAY when the insurer refuses the whole admission, so "the insurer
  // said no and it came back to the family" IS a self-paying stay by the time
  // anyone opens this. The second branch is the PARTIAL revert - some bills
  // moved onto the family while the stay itself stays pointed at the insurer -
  // which leaves payerType alone and would otherwise be refused here.
  // REJECTED ONLY, not PARTIALLY_APPROVED. A flat refusal makes the whole stay
  // the family's, which is what this sheet prices. A part-approval does the
  // opposite: the insurer is still carrying most of it and only the shortfall is
  // the family's - print this and the counter asks them for the insurer's share
  // too. That case has its own path (the co-pay on the discharge screen) and its
  // own document, which is the IP bill.
  //
  // And a SELF_PAY bill on its own proves nothing: a non-covered item is billed
  // to the family on a perfectly live cashless stay every day of the week. It is
  // the refusal AND the moved bill together that mean the family is now paying.
  const rejected = claims.some((c) => c.status === "REJECTED");
  const movedBills = stay.invoices.some((i) => i.payer === "SELF_PAY");
  const basis: SelfPayBasis =
    stay.payerType === "SELF_PAY" ? "SELF_PAY"
    : rejected && movedBills ? "INSURANCE_REFUSED"
    : "NONE";

  const eligibilityNote =
    basis === "SELF_PAY"
      ? rejected
        ? `${base.insurer ?? "The insurer"} refused this stay - it is being paid by the family.`
        : "Self-paying stay."
      : basis === "INSURANCE_REFUSED"
        ? `${base.insurer ?? "The insurer"} refused bills on this stay and they have been moved onto the family.`
        : `This stay is cashless with ${base.insurer ?? "an insurer"}. Print the IP bill instead - a discounted "pay now" sheet would ask the family for money the insurer is carrying.`;

  // ── WHAT HAS ALREADY BEEN COLLECTED, PER BLOCK ──
  //
  // The counters' own bills carry their paid figure already (sourceBills), and
  // each one belongs to exactly the block its counter raised it at.
  const paid: Record<IpBillBucket, number> = { SERVICES: 0, LAB: 0, PHARMACY: 0 };
  for (const b of base.sourceBills) {
    const bucket = BUCKET_OF_SOURCE[b.source] ?? "SERVICES";
    paid[bucket] = round2(paid[bucket] + Number(b.paid));
  }

  // AND MONEY TAKEN AGAINST THE STAY'S OWN INVOICE - a family who paid the
  // balance in cash at discharge must not be shown it again. The IP bill credits
  // the same money through the same helper, so the two sheets cannot disagree.
  //
  // NET OF REFUNDS, and NEVER the deposit: the discharge applies the admission
  // advance as a payment on this same invoice (see advancePaymentRef), and
  // `advance` below already accounts for it. Counting it here too would take the
  // family's deposit off the bill twice.
  for (const inv of stay.invoices) {
    if (inv.source !== "IPD") continue;
    paid.SERVICES = round2(paid.SERVICES + takenOnStayBill(
      inv.payments.map((p) => ({ amount: num(p.amount), reference: p.reference })),
      inv.refunds.map((x) => ({ amount: num(x.amount) })),
    ));
  }

  // ── SERVICES ONLY, FROM HERE DOWN ──
  //
  // The lines, the counter invoices, the payment list and the money are all
  // filtered to the hospital's own block. `bucketOfSection` still does the
  // deciding, on the words rather than against an exact list of titles, so a
  // heading reworded upstairs ("PHARMACY CHARGES" -> "MEDICINES") cannot quietly
  // reappear on a sheet that does not bill it.
  const isServices = (bucket: IpBillBucket) => bucket === "SERVICES";

  const groups: IpServicesGroupDTO[] = base.groups
    .map((g) => {
      const bucket = bucketOfSection(g.title);
      return { ...g, bucket, discountable: isDiscountable(bucket) };
    })
    .filter((g) => isServices(g.bucket));

  // The counters' own invoices, minus the two counters this sheet does not bill.
  // A pharmacy receipt number under "bills included in this statement" says the
  // pharmacy IS included in it, which after the filter above it is not.
  const sourceBills = base.sourceBills.filter((b) =>
    isServices(BUCKET_OF_SOURCE[b.source] ?? "SERVICES")
  );

  // ── PAYMENT DETAILS, WITH THE DEPOSIT LISTED ONCE ──
  //
  // The discharge applies the admission deposit as a payment ON THE STAY'S OWN
  // INVOICE (see advancePaymentRef), so a list built from the advances plus every
  // invoice payment carries it twice. Neither sheet lists it twice now. Its whole claim is "here is everything you have already paid, and
  // here is the difference" - a family adding up this column and landing above
  // the deductions in the totals block has been handed a bill that argues with
  // itself.
  //
  // The stamped reference is what identifies the carried-over deposit, the same
  // marker getInvoice matches on. The AdmissionAdvance row is the one that stays:
  // it carries the deposit's OWN receipt number, which is the slip in the
  // family's hand.
  const payments: BillPaymentDTO[] = [
    ...stay.advances.map((x) => ({
      invoiceNo: x.receiptNo ?? "ADVANCE",
      date: x.createdAt.toISOString(),
      mode: String(x.mode),
      amount: m2(num(x.amount)),
      at: x.createdAt.getTime(),
    })),
    // AND ONLY THE COUNTERS THIS SHEET BILLS. Money handed over at the pharmacy
    // window and the lab counter leaves with their lines: listed here it would
    // be a payment column adding up to more than the bill above it, which is
    // the one discrepancy on a bill nobody accepts an explanation for.
    ...stay.invoices
      .filter((i) => isServices(BUCKET_OF_SOURCE[String(i.source)] ?? "SERVICES"))
      .flatMap((i) =>
        i.payments
          .filter((p) => !p.reference?.startsWith(ADVANCE_REF_PREFIX))
          .map((p) => ({
            invoiceNo: i.receiptNo,
            date: p.createdAt.toISOString(),
            mode: String(p.mode),
            amount: m2(num(p.amount)),
            at: p.createdAt.getTime(),
          }))
      ),
  ]
    .sort((x, y) => x.at - y.at)
    .map(({ at: _at, ...row }) => row);

  // ── THE MONEY, WORKED OUT TWICE, ON PURPOSE ──
  //
  // `money` is what this sheet prints: the services block alone, with the
  // discount, the GST and the deposit against it.
  //
  // `whole` is the same stay with all three blocks, and it is computed for ONE
  // FIGURE that is never printed - what the pharmacy and the lab are still
  // owed. That is subtracted from the refund below. Those dues were eating into
  // the deposit before this sheet ever showed a refund line and they still are;
  // drop them and the desk hands back a deposit the pharmacy is owed out of.
  // THE STAY'S OWN DISCOUNT AND GST, not the IP bill's. That sheet now adds the
  // counters' discounts and tax to its own, because it prints their lines; this
  // one prices the services block, where a pharmacy bill's GST would be tax on
  // medicines it does not list.
  const stayBill = stay.invoices.find((i) => i.source === "IPD");
  const stayDiscount = m2(num(stayBill?.discountAmount));
  const stayGst = m2(round2(num(stayBill?.cgstAmount) + num(stayBill?.sgstAmount)));

  const money = ipServicesBill({
    sections: groups.map((g) => ({ title: g.title, total: g.total })),
    discount: stayDiscount,
    gst: stayGst,
    advance: base.advance,
    paid: { services: paid.SERVICES },
  });

  const whole = ipServicesBill({
    sections: base.groups.map((g) => ({ title: g.title, total: g.total })),
    discount: stayDiscount,
    gst: stayGst,
    advance: base.advance,
    paid: { services: paid.SERVICES, lab: paid.LAB, pharmacy: paid.PHARMACY },
  });
  const counterDue = round2(whole.lab.due + whole.pharmacy.due);
  // Identical, in every case, to the refund the three-block sheet printed.
  const refundDue = round2(Math.max(0, money.refundDue - counterDue));

  const blk = (b: typeof money.services): IpBillBlockDTO => ({
    gross: m2(b.gross), discount: m2(b.discount), net: m2(b.net),
    paid: m2(b.paid), due: m2(b.due), settled: b.settled,
  });

  return {
    ...base,
    groups,
    sourceBills,
    payments,
    eligible: basis !== "NONE",
    basis,
    eligibilityNote,
    money: {
      services: blk(money.services),
      gross: m2(money.gross),
      discount: m2(money.discount),
      discountUnapplied: m2(money.discountUnapplied),
      gst: m2(money.gst),
      netBill: m2(money.netBill),
      paidTotal: m2(money.paidTotal),
      dueBeforeAdvance: m2(money.dueBeforeAdvance),
      advance: m2(money.advance),
      advanceApplied: m2(money.advanceApplied),
      netPayable: m2(money.netPayable),
      refundDue: m2(refundDue),
    },
    // The top-level figures are RESTATED from this sheet's own arithmetic, so
    // anything reading the DTO generically (and the words at the foot of the
    // page) quotes the number this document is actually asking for.
    netPayable: m2(money.netPayable),
  };
}



/**
 * THE MEDICINES THE PATIENT GOES HOME ON, typed on the discharge summary.
 *
 * WHY THIS IS A PRESCRIPTION AND NOT A NEW TABLE. Discharge advice IS a
 * prescription - a named drug, a dose and a quantity, written by a doctor for a
 * patient to take away - and PrescriptionUpload already models exactly that,
 * with the pharmacy master link that lets it be dispensed in two clicks. Adding
 * a second, parallel medicine table to a live hospital database so one screen
 * could have its own copy would have been a schema migration bought for nothing
 * and two places to look for "what was this patient sent home on".
 *
 * It is created UPLOADED, never SENT_TO_PHARMACY, so it does not appear in the
 * pharmacy queue: writing the advice is not the same as asking anyone to
 * dispense it. If the family wants it filled here, the desk dispatches it like
 * any other prescription.
 *
 * ONE PER STAY, replaced wholesale on each save. `title` is the marker - a stay
 * has many prescriptions and only one of them is the discharge advice, and
 * matching on it is what stops every save leaving another copy behind.
 */
export const DISCHARGE_RX_TITLE = "Discharge medication";

export async function setDischargeMedicines(
  actor: AuthUser,
  admissionId: string,
  items: { medicineName: string; qty: number; dosage?: string }[],
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ count: number }> {
  const clean = items
    .map((i) => ({ medicineName: i.medicineName.trim(), qty: Math.max(1, Math.round(i.qty || 1)), dosage: i.dosage?.trim() || null }))
    .filter((i) => i.medicineName.length > 0);

  const adm = await prisma.admission.findUnique({
    where: { id: admissionId },
    select: { id: true, ipNumber: true, patientId: true, doctor: { select: { name: true } } },
  });
  if (!adm) throw new ApiError(404, "Admission not found");

  await prisma.$transaction(async (tx) => {
    const existing = await tx.prescriptionUpload.findFirst({
      where: { admissionId, title: DISCHARGE_RX_TITLE },
      select: { id: true },
    });

    if (existing) {
      // Replaced, not merged: the doctor is editing one list, and a drug they
      // deleted must actually disappear from what the patient is handed.
      await tx.prescriptionUploadItem.deleteMany({ where: { uploadId: existing.id } });
      if (!clean.length) {
        await tx.prescriptionUpload.delete({ where: { id: existing.id } });
        return;
      }
      await tx.prescriptionUploadItem.createMany({
        data: clean.map((i) => ({ uploadId: existing.id, ...i })),
      });
      return;
    }

    if (!clean.length) return;
    await tx.prescriptionUpload.create({
      data: {
        patientId: adm.patientId,
        admissionId,
        uploadedById: actor.id,
        title: DISCHARGE_RX_TITLE,
        doctorName: adm.doctor?.name ?? null,
        // UPLOADED, deliberately - see the note above.
        status: "UPLOADED",
        items: { create: clean },
      },
    });
  });

  await logAudit(actor, {
    action: "DISCHARGE_MEDICINES_SET", targetTable: "Admission", targetId: admissionId,
    meta: { ipNumber: adm.ipNumber, count: clean.length }, ...ctx,
  });
  return { count: clean.length };
}

/** The discharge advice for a stay, for the summary form to load back. */
export async function getDischargeMedicines(
  admissionId: string,
): Promise<{ medicineName: string; qty: number; dosage: string | null }[]> {
  const rx = await prisma.prescriptionUpload.findFirst({
    where: { admissionId, title: DISCHARGE_RX_TITLE },
    select: { items: { select: { medicineName: true, qty: true, dosage: true }, orderBy: { id: "asc" } } },
  });
  return rx?.items ?? [];
}

/**
 * UNDO A TRANSFER THAT SHOULD NOT HAVE HAPPENED.
 *
 * A bed transfer is two writes and a price change, and it is entered by a desk
 * at a counter - so it gets entered against the wrong patient, or to the wrong
 * bed, several times a month. Before this the only repair was to transfer them
 * BACK, which leaves three legs on the bill and a chronology saying the patient
 * toured the hospital. The bill then has to be explained to a family who never
 * moved.
 *
 * ONLY THE LAST LEG COMES OFF, and that is not a limitation - it is the only
 * safe operation. Legs are a chain: each one's start is the previous one's end.
 * Pulling one from the middle would leave a hole no arithmetic can close, and
 * the day distribution would silently reassign days across wards the patient
 * really was in.
 *
 * The note is KEPT and a second one written. Somebody did move this patient in
 * the system, a nurse may have acted on it, and a chronology that can be edited
 * to say otherwise is not a record.
 */
export async function undoLastTransfer(
  actor: AuthUser,
  admissionId: string,
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ movedBackTo: string }> {
  const result = await prisma.$transaction(async (tx) => {
    const adm = await tx.admission.findUnique({
      where: { id: admissionId },
      select: {
        id: true, ipNumber: true, status: true, bedId: true,
        bedStays: { orderBy: { fromDate: "asc" }, select: { id: true, wardName: true, bedId: true, fromDate: true, toDate: true, bed: { select: { bedNo: true } } } },
      },
    });
    if (!adm) throw new ApiError(404, "Admission not found");
    if (adm.status !== "ADMITTED") {
      // A discharged stay's bed charges are already on an issued invoice.
      throw new ApiError(409, "This stay is closed. Correct the bill instead of the bed.");
    }
    if (adm.bedStays.length < 2) {
      throw new ApiError(409, "There is no transfer on this stay to undo");
    }

    const current = adm.bedStays[adm.bedStays.length - 1];
    const previous = adm.bedStays[adm.bedStays.length - 2];

    // Put the patient back where they were, and reopen that leg so the days
    // flow through it again.
    await tx.bedStay.delete({ where: { id: current.id } });
    await tx.bedStay.update({ where: { id: previous.id }, data: { toDate: null } });

    if (current.bedId) await tx.bed.update({ where: { id: current.bedId }, data: { status: "AVAILABLE" } });
    if (previous.bedId) await tx.bed.update({ where: { id: previous.bedId }, data: { status: "OCCUPIED" } });

    await tx.admission.update({
      where: { id: adm.id },
      data: { bedId: previous.bedId ?? undefined, wardNameAtAdmit: previous.wardName },
    });

    await tx.admissionNote.create({
      data: {
        admissionId: adm.id,
        kind: "NURSING",
        body: `Transfer to ${bedLabel(current.wardName, current.bed?.bedNo)} removed - entered in error. Back in ${bedLabel(previous.wardName, previous.bed?.bedNo)}.`,
        authorId: actor.id,
      },
    });

    return {
      ipNumber: adm.ipNumber,
      backTo: bedLabel(previous.wardName, previous.bed?.bedNo),
      removed: bedLabel(current.wardName, current.bed?.bedNo),
    };
  });

  await logAudit(actor, {
    action: "BED_TRANSFER_UNDONE", targetTable: "Admission", targetId: admissionId,
    meta: { ipNumber: result.ipNumber, removed: result.removed, backTo: result.backTo }, ...ctx,
  });
  await publishLive([TOPICS.IPD, TOPICS.RECEPTION, TOPICS.INSURANCE, TOPICS.ADMIN], EVENTS.ADMISSION_CORRECTED);
  return { movedBackTo: result.backTo };
}
