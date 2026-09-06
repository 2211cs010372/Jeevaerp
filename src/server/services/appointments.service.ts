import { prisma } from "@/lib/prisma";
import { nextId } from "@/lib/ids";
import { ApiError } from "@/lib/api";
import { localDateISO, parseDateOnly } from "@/lib/date";
import { opFeeFor } from "@/lib/after-hours";
import { resolveReferral } from "@/lib/referral";
import { logAudit } from "./audit.service";
import { createInvoice } from "./billing.service";
import { notifyOpBooked, notifyOpCancelled } from "./notify.service";
import { getAfterHoursOpPolicy } from "./op-pricing.service";
import { generateSlots, SLOT_HORIZON_DAYS, DIARY_START, DIARY_END, DIARY_SLOT_MIN } from "./slots.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

/**
 * Tell every screen that watches the day's movement.
 *
 * The desk's Today board, the consulting room's queue and the owner's overview
 * are three views of ONE list, so they move together or they disagree. A patient
 * checked in at the counter has to appear in the doctor's queue without anybody
 * pressing anything - that walk down the corridor is the entire window in which
 * a stale screen is wrong.
 *
 * Fire-and-forget by contract: publishLive swallows its own failures, so a
 * booking never fails because a notification did.
 */
const announceVisitChange = () =>
  publishLive([TOPICS.RECEPTION, TOPICS.DOCTOR, TOPICS.ADMIN], EVENTS.APPOINTMENT_CHANGED);

export interface DoctorDTO {
  id: string; name: string; specialization: string; department: string; fee: string;
  registrationNo: string | null;
  qualification: string | null; experienceYears: number | null; age: number | null;
  languages: string | null; photoUrl: string | null; bio: string | null;
}
export interface SlotDTO { id: string; startTime: string; endTime: string; }

/** Reception-facing appointment (NO referral fields - those are admin-only). */
export interface AppointmentDTO {
  checkedInAt?: string | null;
  id: string; opNumber: string; time: string; status: string; type: string; price: string;
  /** True once a prescription / OPD sheet has been filed against this visit. */
  hasRx: boolean;
  patient: { id: string; displayId: string; name: string };
  /** NULL on an emergency/casualty visit taken before a consultant was assigned.
   *  Deliberately not a placeholder object: a fake `{ id: "casualty" }` would be
   *  passed straight into /slots?doctorId=… by the reschedule dialog. */
  doctor: { id: string; name: string; department: string } | null;
}

/** Visit types that may be taken with no slot and no named doctor. */
const UNSCHEDULED_TYPES = ["EMERGENCY", "CASUALTY"] as const;
export type AppointmentTypeT = "WALKIN" | "ONLINE" | "EMERGENCY" | "CASUALTY";
const isUnscheduled = (t: AppointmentTypeT) => (UNSCHEDULED_TYPES as readonly string[]).includes(t);

/** What the paper says when nobody was named at the desk. */
export const DUTY_DOCTOR = {
  name: "Duty Medical Officer",
  specialization: "Casualty Medical Officer",
  department: "Emergency & Casualty",
  /** No degrees to print for a role that isn't a person yet. */
  qualification: null,
  /** …and no council number either. A registration number belongs to a named
   *  physician; printing anything here would attribute the prescription to
   *  somebody who has not been identified. */
  registrationNo: null,
} as const;

/** Admin-facing appointment - INCLUDES the referral snapshot. */
export interface AdminAppointmentDTO extends AppointmentDTO {
  visitDate: string;
  /** Resolved by lib/referral.ts: this visit's referral, else the patient's. */
  referredByName: string | null;
  referralSource: string | null;
  /** true when the referral above came from the PATIENT record, not this visit.
   *  The screen says so, because a patient-level referral repeats on every
   *  later visit - so a tally over it counts visits, not new patients. */
  referralFromPatient: boolean;
  /** Most recent invoice raised against this visit, with how it was paid. */
  bill: { total: string; status: string; paymentModes: string[] } | null;
}

export async function listDoctors(): Promise<DoctorDTO[]> {
  const rows = await prisma.doctor.findMany({
    where: { active: true }, orderBy: { name: "asc" },
    select: {
      id: true, name: true, specialization: true, department: true, consultationFee: true,
      registrationNo: true,
      qualification: true, experienceYears: true, age: true, languages: true, photoUrl: true, bio: true,
    },
  });
  type Row = {
    id: string; name: string; specialization: string; department: string; consultationFee: { toString(): string };
    registrationNo: string | null;
    qualification: string | null; experienceYears: number | null; age: number | null; languages: string | null; photoUrl: string | null; bio: string | null;
  };
  return (rows as Row[]).map((d) => ({
    id: d.id, name: d.name, specialization: d.specialization, department: d.department, fee: d.consultationFee.toString(),
    registrationNo: d.registrationNo,
    qualification: d.qualification, experienceYears: d.experienceYears, age: d.age, languages: d.languages, photoUrl: d.photoUrl, bio: d.bio,
  }));
}

export async function listAvailableSlots(doctorId: string, date: string): Promise<SlotDTO[]> {
  // DoctorSlot.date is @db.Date, stored and read at UTC midnight. Building the
  // query value with setHours(0,0,0,0) gave 18:30 the PREVIOUS day in IST, so
  // asking for Monday returned Sunday's grid - and the booking that followed
  // landed on Sunday. Date-only column, date-only parse.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "Invalid date");
  const day = parseDateOnly(date);
  if (Number.isNaN(day.getTime())) throw new ApiError(400, "Invalid date");
  // Every still-open slot for the day. Past-today slots are NOT dropped here -
  // the desk shows the whole day and greys the passed ones out (un-bookable),
  // rather than silently starting the grid mid-afternoon. The client marks
  // "past" by the wall clock; bookAppointment refuses a passed slot as a net.
  return prisma.doctorSlot.findMany({
    where: { doctorId, date: day, isBooked: false, isBlocked: false },
    orderBy: { startTime: "asc" },
    select: { id: true, startTime: true, endTime: true },
  });
}

/**
 * Book an appointment. Concurrency-safe atomic slot claim:
 *   updateMany({ where: { id, isBooked: false }, data: { isBooked: true } })
 * count 0 => already taken. Whole op in a transaction (rollback frees the slot);
 * Appointment.slotId UNIQUE is the second guarantee. Consultation fee and the
 * per-visit referral are snapshotted onto the appointment at this moment.
 *
 * TWO SHAPES OF VISIT:
 *
 *   SCHEDULED (WALKIN / ONLINE) - a slot is mandatory. The slot is the source of
 *   truth for doctor, date and time; a scheduled visit with no slot would be a
 *   booking nobody can find on any doctor's list, so it is rejected outright.
 *
 *   UNSCHEDULED (EMERGENCY / CASUALTY) - no slot, and the doctor is optional.
 *   Date and time come from the wall clock, and the visit is created already
 *   CHECKED_IN because the patient is, by definition, physically in the building.
 */
export async function bookAppointment(
  actor: AuthUser,
  input: {
    patientId: string; slotId?: string; doctorId?: string; type: AppointmentTypeT;
    referredByName?: string; referralSource?: string;
    /** What the desk agreed to charge, overriding the day fee / after-hours rate. */
    feeOverride?: number;
    /** Reception can bill the consultation in the same motion, so the patient
     *  leaves the desk with an OP number AND a receipt - one queue, not two. */
    billNow?: {
      discountAmount?: number;
      payment?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string };
      payments?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string }[];
    };
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<AppointmentDTO & { invoice?: { id: string; receiptNo: string; totalAmount: string; status: string } }> {
  const nn = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  const unscheduled = isUnscheduled(input.type);
  const requestedSlotId = nn(input.slotId);
  const requestedDoctorId = nn(input.doctorId);

  // A scheduled visit without a slot would land nowhere on any doctor's day.
  // Catch it here rather than silently writing a doctorless WALKIN row.
  if (!unscheduled && !requestedSlotId) throw new ApiError(400, "Pick a time slot for this visit");

  // Read outside the transaction: it's one small row, it isn't written here, and
  // holding the booking's lock open for a settings lookup buys nothing.
  const policy = await getAfterHoursOpPolicy();

  const appt = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const patient = await tx.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true, displayId: true, fullName: true, mergedIntoId: true, deletedAt: true },
    });
    if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "Patient not found");

    let slot = null;
    let targetDoctorId = requestedDoctorId;
    // Wall clock, in the clinic's own timezone. `toISOString()` here filed a
    // 2 AM casualty case under YESTERDAY in IST - and emergencies are exactly
    // the visits that happen at 2 AM. See lib/date.ts: date-only column -> UTC
    // midnight of the LOCAL calendar day.
    const now = new Date();
    let visitDate = parseDateOnly(localDateISO(now));
    let timeAtBooking = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    if (requestedSlotId) {
      slot = await tx.doctorSlot.findUnique({
        where: { id: requestedSlotId },
        select: { id: true, doctorId: true, date: true, startTime: true, isBooked: true, isBlocked: true },
      });
      if (!slot) throw new ApiError(404, "That time slot no longer exists");
      if (slot.isBlocked) throw new ApiError(409, "That time is blocked - the doctor isn't available then");
      if (slot.isBooked) throw new ApiError(409, "That slot was just taken. Please pick another.");
      if (!slot.startTime) throw new ApiError(500, "That slot has no start time - tell IT before booking.");

      const claim = await tx.doctorSlot.updateMany({
        where: { id: slot.id, isBooked: false }, data: { isBooked: true },
      });
      if (claim.count === 0) throw new ApiError(409, "That slot was just taken. Please pick another.");

      // The slot wins over anything the client sent: it is what the grid showed.
      targetDoctorId = slot.doctorId;
      visitDate = slot.date;
      timeAtBooking = slot.startTime;
    }

    // Fee is snapshotted from the named doctor. An unscheduled visit with nobody
    // named carries ₹0 - casualty charges are raised afterwards, per procedure.
    let consultationFee = 0;
    let dayFee = 0;
    let afterHours = false;
    if (targetDoctorId) {
      const doctor = await tx.doctor.findUnique({
        where: { id: targetDoctorId }, select: { id: true, active: true, consultationFee: true },
      });
      // Without this the bad id reached the FK and surfaced as a 500. It is a
      // 404, and reception can act on a 404.
      if (!doctor) throw new ApiError(404, "That doctor no longer exists");
      if (!doctor.active && !slot) throw new ApiError(409, "That doctor is no longer in practice here");
      dayFee = Number(doctor.consultationFee);

      // Once the OP clinic has closed, the doctor is being called in and the
      // visit is priced as an emergency. Keyed off timeAtBooking, NOT the
      // wall clock: a slot booked this evening for tomorrow 9 AM is a daytime
      // visit, and an 8:30 PM slot is an after-hours one whenever it was booked.
      const priced = opFeeFor(dayFee, timeAtBooking, policy);
      consultationFee = priced.fee;
      afterHours = priced.afterHours;
    }

    // What the desk agreed, overriding the policy figure. Kept separate from the
    // computation above so the audit trail can still say what the policy WOULD
    // have charged - "₹800 instead of ₹1,200" is the reviewable fact, and
    // storing only the final number throws it away.
    //
    // Ignored when no doctor was named, which preserves the rule above: a
    // casualty case taken with no consultant carries ₹0 and its charges are
    // raised from Billing once the procedures are known. Without this guard an
    // override would be the one way to put a consultation fee on a visit that
    // has nobody to attribute it to.
    const canOverride = input.feeOverride !== undefined && targetDoctorId !== null;
    const overridden = canOverride && input.feeOverride !== consultationFee;
    if (canOverride) consultationFee = Math.round(input.feeOverride as number);

    const opNumber = await nextId("OP", { tx });
    const created = await tx.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: targetDoctorId,
        slotId: slot ? slot.id : null,
        visitDate,
        timeAtBooking,
        type: input.type,
        // An emergency patient is already in the building - making the desk
        // press "Check in" a second later would be theatre, and until they did
        // the casualty case would read as "yet to arrive" on every screen.
        status: unscheduled ? "CHECKED_IN" : "BOOKED",
        checkedInAt: unscheduled ? now : null,
        opNumber,
        priceAtBooking: consultationFee,
        referredByName: nn(input.referredByName),
        referralSource: nn(input.referralSource),
        createdById: actor.id,
      },
      select: {
        id: true, opNumber: true, status: true, type: true, priceAtBooking: true,
        timeAtBooking: true, checkedInAt: true,
        // visitDate and phone are here for the confirmation SMS below, which
        // runs after this transaction has closed and cannot reach the local
        // `visitDate` variable.
        visitDate: true,
        patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
        doctor: { select: { id: true, name: true, department: true } },
      },
    });

    await logAudit(
      actor,
      {
        action: unscheduled ? "EMERGENCY_OP_ISSUED" : "APPOINTMENT_BOOKED",
        targetTable: "Appointment", targetId: created.id,
        meta: {
          opNumber, patientId: patient.displayId, type: input.type, doctorId: targetDoctorId,
          // Only recorded when the clock or a human changed the price, so an
          // ordinary daytime booking's audit row stays as small as it was.
          ...(afterHours ? { afterHours: true, dayFee, multiplier: policy.multiplier } : {}),
          ...(overridden ? { feeOverride: consultationFee, policyFee: afterHours ? Math.round(dayFee * policy.multiplier) : dayFee } : {}),
        },
        ...ctx,
      },
      tx
    );
    return created;
  });

  const dto: AppointmentDTO = {
    id: appt.id, opNumber: appt.opNumber, time: appt.timeAtBooking, status: appt.status,
    type: appt.type, price: appt.priceAtBooking.toString(), hasRx: false,
    checkedInAt: appt.checkedInAt ? appt.checkedInAt.toISOString() : null,
    patient: { id: appt.patient.id, displayId: appt.patient.displayId, name: appt.patient.fullName },
    doctor: appt.doctor,
  };

  // ── confirmation, after the row is safely committed ──────────────────────
  //
  // The desk's booking gets the same text the website's does, from the same DLT
  // template - the patient cannot tell which counter typed it.
  //
  // NOT SENT FOR A CASUALTY / EMERGENCY OP. That patient is already through the
  // door, so "your appointment is confirmed for today at 14:32" is a message
  // about something that has already happened, sent to a phone that is in the
  // building. The OP number they need is on the sheet in their hand.
  if (!unscheduled) {
    await notifyOpBooked(appt.patient.phone, {
      name: appt.patient.fullName,
      opNumber: appt.opNumber,
      doctor: appt.doctor ? appt.doctor.name : DUTY_DOCTOR.name,
      date: appt.visitDate,
      time: appt.timeAtBooking,
    });
  }

  // Book + bill in one motion. The consultation invoice reuses the same
  // engine as labs/pharmacy - consultation is GST-exempt by default.
  //
  // A ₹0 line is skipped rather than billed: a casualty case with no consultant
  // yet has nothing to charge, and raising the bill anyway would burn a receipt
  // number on an empty invoice and leave a phantom ₹0 "unpaid" bill on the
  // billing screen forever.
  const billableNow = Number(appt.priceAtBooking.toString()) > 0;
  if (input.billNow && billableNow) {
    const seenBy = appt.doctor
      ? `${appt.doctor.name} (${appt.doctor.department})`
      : `${DUTY_DOCTOR.name} (${DUTY_DOCTOR.department})`;
    const invoice = await createInvoice(
      actor,
      {
        patientId: appt.patient.id,
        source: "CONSULTATION",
        appointmentId: appt.id,
        lines: [{
          description: `Consultation · ${seenBy} · ${appt.opNumber}`,
          qty: 1,
          unitPrice: Number(appt.priceAtBooking.toString()),
          gstRatePct: 0,
        }],
        discountAmount: input.billNow.discountAmount,
        payment: input.billNow.payment,
        payments: input.billNow.payments,
        // The booking SMS above already went out for this same visit, and the
        // counter is handing over a printed receipt as it sends. A second text
        // saying the consultation was billed is a second charge for news the
        // patient is holding in their hand.
        notify: false,
      },
      ctx
    );
    await announceVisitChange();
    return { ...dto, invoice: { id: invoice.id, receiptNo: invoice.receiptNo, totalAmount: invoice.totalAmount, status: invoice.status } };
  }

  await announceVisitChange();
  return dto;
}

const apptSelect = {
  id: true, opNumber: true, status: true, type: true, priceAtBooking: true, visitDate: true,
  referredByName: true, referralSource: true, timeAtBooking: true, checkedInAt: true,
  patient: { select: { id: true, displayId: true, fullName: true } },
  doctor: { select: { id: true, name: true, department: true } },
  // Has a prescription / OPD sheet been filed for this visit yet?
  _count: { select: { prescriptionUploads: true } },
} as const;

type ApptRow = {
  id: string; opNumber: string; status: string; type: string;
  priceAtBooking: { toString(): string }; visitDate: Date;
  referredByName: string | null; referralSource: string | null;
  timeAtBooking: string; checkedInAt: Date | null;
  patient: { id: string; displayId: string; fullName: string };
  doctor: { id: string; name: string; department: string } | null;
  _count: { prescriptionUploads: number };
};

/** Reception queue for today - referral STRIPPED. */
export async function todaysAppointments(): Promise<AppointmentDTO[]> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rows: ApptRow[] = await prisma.appointment.findMany({
    where: { visitDate: today, status: { not: "CANCELLED" } },
    orderBy: { timeAtBooking: "asc" }, select: apptSelect,
  });
  return rows.map((a) => ({
    id: a.id, opNumber: a.opNumber, time: a.timeAtBooking, status: a.status, type: a.type,
    price: a.priceAtBooking.toString(),
    hasRx: a._count.prescriptionUploads > 0,
    checkedInAt: a.checkedInAt ? a.checkedInAt.toISOString() : null,
    patient: { id: a.patient.id, displayId: a.patient.displayId, name: a.patient.fullName },
    doctor: a.doctor,
  }));
}

/** ADMIN-ONLY appointment history - INCLUDES referral snapshot. */
export async function adminAppointmentHistory(limit = 100): Promise<AdminAppointmentDTO[]> {
  const MODE_ORDER = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"];
  const rows = await prisma.appointment.findMany({
    orderBy: { createdAt: "desc" }, take: limit,
    select: {
      ...apptSelect,
      // Overrides apptSelect's narrower `patient`, rather than widening the
      // shared one. apptSelect is also what the RECEPTION queue reads, and the
      // referral is admin-only - see the note in reception.service.ts. Reception
      // must not even fetch it, never mind serialize it.
      patient: {
        select: {
          id: true, displayId: true, fullName: true,
          referredByName: true, referralSource: true,
        },
      },
      invoices: {
        orderBy: { createdAt: "desc" }, take: 1,
        select: { totalAmount: true, status: true, payments: { select: { mode: true, amount: true } } },
      },
    },
  });
  type Inv = { totalAmount: { toString(): string }; status: string; payments: { mode: string; amount: { toString(): string } }[] };
  type AdminRow = Omit<ApptRow, "patient"> & {
    patient: ApptRow["patient"] & { referredByName: string | null; referralSource: string | null };
    invoices: Inv[];
  };
  return rows.map((a: AdminRow) => {
    const inv = a.invoices[0];
    const bill = inv
      ? {
          total: inv.totalAmount.toString(),
          status: inv.status,
          paymentModes: MODE_ORDER.filter((m) => inv.payments.some((p) => p.mode === m && Number(p.amount.toString()) > 0)),
        }
      : null;
    // This visit's referral if the booking desk typed one, else the patient's.
    // In practice it is nearly always the patient's: the registration form is
    // the one that gets filled, and the booking form's copy is left blank. See
    // lib/referral.ts for why that made this whole screen read "Walk-in".
    const referral = resolveReferral(a, a.patient);
    return {
      id: a.id, opNumber: a.opNumber, time: a.timeAtBooking, status: a.status, type: a.type,
      price: a.priceAtBooking.toString(),
      hasRx: a._count.prescriptionUploads > 0,
      visitDate: a.visitDate.toISOString().slice(0, 10),
      referredByName: referral.name,
      referralSource: referral.source,
      referralFromPatient: referral.fromPatient,
      patient: { id: a.patient.id, displayId: a.patient.displayId, name: a.patient.fullName },
      doctor: a.doctor,
      bill,
    };
  });
}

export async function receptionTodayStats(): Promise<{
  total: number; expected: number; waiting: number; checkedIn: number; completed: number; newPatients: number;
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const [total, expected, checkedIn, completed, newPatients] = await Promise.all([
    prisma.appointment.count({ where: { visitDate: today, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { visitDate: today, status: "BOOKED" } }),
    prisma.appointment.count({ where: { visitDate: today, status: "CHECKED_IN" } }),
    prisma.appointment.count({ where: { visitDate: today, status: "COMPLETED" } }),
    prisma.patient.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
  ]);
  // "waiting" = arrived and sitting outside the doctor's room. It is NOT
  // "total minus completed" - that counted people who hadn't walked in yet.
  return { total, expected, waiting: checkedIn, checkedIn, completed, newPatients };
}

/** Everything the printed OPD sheet needs, in one fetch. */
export async function opdPrintData(appointmentId: string): Promise<{
  hospital: { legalName: string; addressLine: string; city: string; state: string; stateCode: string; pincode: string; gstin: string | null; phone: string | null } | null;
  appointment: { id: string; opNumber: string; type: string; status: string; visitDate: string; time: string; referredByName: string | null; visitNumber: number };
  /** The named consultant, or the duty-doctor block for an unattributed
   *  casualty case. `named` is false in the latter, so the sheet prints a
   *  signature line to fill in rather than "Dr. Duty Medical Officer". */
  /** `qualification` is the degree line the pre-printed stationery prints under
   *  the doctor's name ("MBBS, M.D Paediatrics") - null for the duty block.
   *  `registrationNo` prints directly beneath it: a prescription must carry the
   *  council number of the physician who wrote it. Null until somebody types it
   *  on the roster, and null forever for the duty block, which is a role. */
  doctor: { name: string; specialization: string; department: string; qualification: string | null; registrationNo: string | null; named: boolean };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; bloodGroup: string | null; phone: string; address: string | null; city: string | null };
  /** `medicineId` is carried for the READERS of this bundle, not the printed
   *  sheet: reception's prescription form loads a visit back into its fields,
   *  and a medicine that arrives without its catalog id degrades to free text
   *  the pharmacist has to match by hand a second time. */
  rxItems: { medicineName: string; medicineId: string | null; qty: number; dosage: string | null }[];
  vitals: VitalsDTO | null;
  clinical: {
    diagnosis: string | null; advice: string | null;
    /** Advised tests, each carrying whether an order was ever raised for it. */
    labs: { name: string; ordered: boolean; declined: boolean }[];
    nextVisit: string | null; caseHistory: string | null;
  } | null;
  /**
   * What the lab wrote against this visit's completed tests - one line per test
   * that has an impression. Printed in the sheet's Investigation block, under
   * the lab's name, because it is the bench's read of a specimen and not the
   * consultant's diagnosis.
   */
  labImpressions: { testName: string; impression: string }[];
}> {
  const a = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true, opNumber: true, type: true, status: true, visitDate: true, referredByName: true, createdAt: true, patientId: true,
      timeAtBooking: true,
      doctor: { select: { name: true, specialization: true, department: true, qualification: true, registrationNo: true } },
      patient: { select: { displayId: true, fullName: true, age: true, gender: true, bloodGroup: true, phone: true, address: true, city: true } },
    },
  });
  if (!a) throw new ApiError(404, "Appointment not found");

  const [hospital, visitNumber, upload, vitals, labRows] = await Promise.all([
    prisma.hospitalConfig.findFirst(),
    // "#Visit: 3" the way the paper shows it - this visit's ordinal for the patient.
    prisma.appointment.count({ where: { patientId: a.patientId, createdAt: { lte: a.createdAt } } }),
    prisma.prescriptionUpload.findFirst({
      where: { appointmentId: a.id },
      orderBy: { createdAt: "desc" },
      select: {
        items: { select: { medicineName: true, medicineId: true, qty: true, dosage: true }, orderBy: { id: "asc" } },
        diagnosis: true, advice: true, nextVisit: true, caseHistory: true,
        advisedLabs: { select: { testName: true, labTestId: true, declinedAt: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.vitals.findUnique({ where: { appointmentId: a.id } }),
    // Only tests the bench actually wrote on. A completed test with no
    // impression has nothing to say here - its numbers are on the lab report.
    prisma.labTest.findMany({
      where: { appointmentId: a.id, impression: { not: null } },
      orderBy: { completedAt: "asc" },
      select: { testName: true, impression: true },
    }),
  ]);

  return {
    hospital,
    appointment: {
      id: a.id, opNumber: a.opNumber, type: a.type, status: a.status,
      visitDate: a.visitDate.toISOString().slice(0, 10),
      time: a.timeAtBooking, referredByName: a.referredByName, visitNumber,
    },
    doctor: a.doctor ? { ...a.doctor, named: true } : { ...DUTY_DOCTOR, named: false },
    patient: a.patient,
    rxItems: upload?.items ?? [],
    vitals: vitals ? toVitalsDTO(vitals) : null,
    clinical: upload && (upload.diagnosis || upload.advice || upload.advisedLabs.length || upload.nextVisit || upload.caseHistory)
      ? {
          diagnosis: upload.diagnosis,
          advice: upload.advice,
          // The printed sheet carries the advice AND what became of it. A test
          // the doctor asked for that nobody ordered is the one line on this
          // page that most needs to be visible.
          labs: upload.advisedLabs.map((l) => ({
            name: l.testName,
            ordered: l.labTestId !== null,
            declined: l.declinedAt !== null,
          })),
          nextVisit: upload.nextVisit,
          caseHistory: upload.caseHistory,
        }
      : null,
    labImpressions: (labRows as { testName: string; impression: string | null }[])
      .filter((l): l is { testName: string; impression: string } => !!l.impression)
      .map((l) => ({ testName: l.testName, impression: l.impression })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VITALS - BP, pulse, height, weight, temp, SpO2 for one visit. Printed blank
// at booking for the triage pen; reception types the handwritten numbers back
// in here afterwards, same two-step paper-first flow as the ℞ table.
// ─────────────────────────────────────────────────────────────────────────────

export interface VitalsDTO {
  bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null;
  tempF: number | null; spo2: number | null; heightCm: number | null; weightKg: number | null;
  recordedAt: string;
}

function toVitalsDTO(v: {
  bpSystolic: number | null; bpDiastolic: number | null; pulse: number | null;
  tempF: Prisma.Decimal | null; spo2: number | null;
  heightCm: Prisma.Decimal | null; weightKg: Prisma.Decimal | null;
  recordedAt: Date;
}): VitalsDTO {
  return {
    bpSystolic: v.bpSystolic, bpDiastolic: v.bpDiastolic, pulse: v.pulse,
    tempF: v.tempF ? Number(v.tempF) : null, spo2: v.spo2,
    heightCm: v.heightCm ? Number(v.heightCm) : null,
    weightKg: v.weightKg ? Number(v.weightKg) : null,
    recordedAt: v.recordedAt.toISOString(),
  };
}

/** Fetch the vitals typed in so far for this visit (or null - nothing typed yet). */
export async function getVitals(appointmentId: string): Promise<VitalsDTO | null> {
  const v = await prisma.vitals.findUnique({ where: { appointmentId } });
  return v ? toVitalsDTO(v) : null;
}

/**
 * Upsert vitals for a visit. Every field optional and independently
 * overwritable - reception fills in whatever the handwritten sheet has,
 * and can come back and add the rest later without clobbering what's there
 * (fields left out of `input` are simply not part of this call's `data`,
 * but since this is a full-row upsert a caller resubmitting the whole form
 * is the expected pattern - same as the ℞ item list on prescriptions).
 */
export async function recordVitals(
  actor: AuthUser,
  appointmentId: string,
  input: {
    bpSystolic?: number; bpDiastolic?: number; pulse?: number;
    tempF?: number; spo2?: number; heightCm?: number; weightKg?: number;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<VitalsDTO> {
  const appt = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { id: true } });
  if (!appt) throw new ApiError(404, "Appointment not found");

  const data = {
    bpSystolic: input.bpSystolic ?? null,
    bpDiastolic: input.bpDiastolic ?? null,
    pulse: input.pulse ?? null,
    tempF: input.tempF ?? null,
    spo2: input.spo2 ?? null,
    heightCm: input.heightCm ?? null,
    weightKg: input.weightKg ?? null,
  };

  const row = await prisma.vitals.upsert({
    where: { appointmentId },
    create: { appointmentId, recordedById: actor.id, ...data },
    update: { recordedById: actor.id, ...data },
  });

  await logAudit(actor, {
    action: "VITALS_RECORDED",
    targetTable: "Vitals",
    targetId: row.id,
    meta: { appointmentId },
    ...ctx,
  });

  // Vitals are taken at triage and read in the consulting room minutes later.
  await announceVisitChange();
  return toVitalsDTO(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// VISIT LIFECYCLE - the front desk's actual verbs.
// The schema always had CHECKED_IN / CANCELLED / checkedInAt / cancelledAt.
// Nothing ever wrote them, so "Checked in" read 0 forever and a booking could
// never be undone. These close that loop.
// ─────────────────────────────────────────────────────────────────────────────

/** Patient physically walked in. BOOKED -> CHECKED_IN. */
export async function checkInAppointment(
  actor: AuthUser,
  appointmentId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; status: string; checkedInAt: string }> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, status: true, opNumber: true },
  });
  if (!appt) throw new ApiError(404, "Appointment not found");
  if (appt.status === "CHECKED_IN") throw new ApiError(409, "This patient is already checked in");
  if (appt.status === "COMPLETED") throw new ApiError(409, "This visit is already complete");
  if (appt.status === "CANCELLED") throw new ApiError(409, "This visit was cancelled");

  const now = new Date();
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "CHECKED_IN", checkedInAt: now },
  });
  await logAudit(actor, {
    action: "APPOINTMENT_CHECKED_IN", targetTable: "Appointment", targetId: appointmentId,
    meta: { opNumber: appt.opNumber }, ...ctx,
  });
  // THE one that matters most: the patient is now walking to the consulting
  // room, and the doctor's queue has to know before they get there.
  await announceVisitChange();
  return { id: appointmentId, status: "CHECKED_IN", checkedInAt: now.toISOString() };
}

/**
 * Name the doctor who actually attended an emergency / casualty visit.
 *
 * Without this an unattributed visit is a DEAD END: only the assigned doctor can
 * mark a visit COMPLETED (doctor.service enforces `appt.doctorId === doc.id`),
 * so a casualty case with nobody on it would sit CHECKED_IN forever, never reach
 * the completed-visits list, and never count towards revenue-by-doctor.
 *
 * This is the same paper-first loop the rest of the desk runs on: the sheet
 * prints an "Attended by" line, the CMO writes their name on it, reception types
 * it back in. One-way on purpose - it fills a blank, it does not reassign a
 * visit away from a doctor who has already been credited (and possibly billed)
 * for it. That would be a cancel-and-rebook decision, made deliberately.
 *
 * Money: the fee is snapshotted now, the same way booking does it - but ONLY if
 * nothing has been billed yet. Once an invoice exists, priceAtBooking is what
 * that invoice was raised against and must not shift underneath it.
 */
export async function assignAppointmentDoctor(
  actor: AuthUser,
  input: { appointmentId: string; doctorId: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; doctor: { id: string; name: string; department: string }; price: string }> {
  // Announced after the commit, never inside it - a signal sent from within a
  // transaction that then rolls back tells every screen to go and re-read a
  // change that never happened.
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const appt = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      select: {
        id: true, opNumber: true, status: true, doctorId: true, type: true,
        invoices: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      },
    });
    if (!appt) throw new ApiError(404, "Appointment not found");
    if (appt.doctorId) throw new ApiError(409, "This visit already has a doctor. Cancel and rebook to change it.");
    if (appt.status === "CANCELLED") throw new ApiError(409, "This visit was cancelled");

    const doctor = await tx.doctor.findUnique({
      where: { id: input.doctorId },
      select: { id: true, name: true, department: true, active: true, consultationFee: true },
    });
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (!doctor.active) throw new ApiError(409, "That doctor is no longer in practice here");

    const alreadyBilled = appt.invoices.length > 0;
    const price = alreadyBilled ? undefined : doctor.consultationFee;

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { doctorId: doctor.id, ...(price !== undefined ? { priceAtBooking: price } : {}) },
      select: { priceAtBooking: true },
    });

    await logAudit(actor, {
      action: "APPOINTMENT_DOCTOR_ASSIGNED", targetTable: "Appointment", targetId: appt.id,
      meta: { opNumber: appt.opNumber, type: appt.type, doctorId: doctor.id, feeSnapshotted: !alreadyBilled },
      ...ctx,
    }, tx);

    return {
      id: appt.id,
      doctor: { id: doctor.id, name: doctor.name, department: doctor.department },
      price: updated.priceAtBooking.toString(),
    };
  });

  await announceVisitChange();
  return result;
}

/** Undo a mis-click. CHECKED_IN -> BOOKED. Refused once the doctor has seen them. */
export async function undoCheckIn(
  actor: AuthUser,
  appointmentId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId }, select: { status: true, opNumber: true, type: true },
  });
  if (!appt) throw new ApiError(404, "Appointment not found");
  if (appt.status !== "CHECKED_IN") throw new ApiError(409, "That visit isn't checked in");
  // An emergency visit is created already arrived - "un-arriving" it would leave
  // a casualty case sitting in the "yet to arrive" column. Cancel it instead.
  if (appt.type === "EMERGENCY" || appt.type === "CASUALTY") {
    throw new ApiError(409, "An emergency visit is arrived by definition. Cancel it if it was raised by mistake.");
  }

  await prisma.appointment.update({
    where: { id: appointmentId }, data: { status: "BOOKED", checkedInAt: null },
  });
  await logAudit(actor, {
    action: "APPOINTMENT_CHECKIN_UNDONE", targetTable: "Appointment", targetId: appointmentId,
    meta: { opNumber: appt.opNumber }, ...ctx,
  });
  await announceVisitChange();
}

/**
 * Cancel a visit AND RELEASE THE SLOT so someone else can take it.
 *
 * The release is the whole point. Appointment.slotId is UNIQUE, so if a cancelled
 * row kept holding its slot, that time would be burned forever - no one could
 * ever book it again. We null slotId (Postgres permits many NULLs under a unique
 * index) and flip the slot back to isBooked=false. The visit row itself is kept:
 * nothing medical is hard-deleted, and timeAtBooking preserves when it *was*.
 *
 * Any bill already raised for this visit is deliberately NOT touched - refunding
 * money is a separate, deliberate act. The caller is told a paid bill exists.
 */
export async function cancelAppointment(
  actor: AuthUser,
  input: { appointmentId: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; opNumber: string; paidInvoice: { receiptNo: string; amountPaid: string } | null }> {
  if (!input.reason?.trim()) throw new ApiError(400, "A cancellation reason is required");

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const appt = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      select: {
        id: true, opNumber: true, status: true, slotId: true,
        // For the "your visit is cancelled" text sent after this closes.
        visitDate: true,
        patient: { select: { fullName: true, phone: true } },
        invoices: {
          where: { status: { not: "CANCELLED" } },
          select: { receiptNo: true, totalAmount: true, payments: { select: { amount: true } } },
        },
      },
    });
    if (!appt) throw new ApiError(404, "Appointment not found");
    if (appt.status === "CANCELLED") throw new ApiError(409, "Already cancelled");
    if (appt.status === "COMPLETED") throw new ApiError(409, "This visit is already complete - it can't be cancelled");

    // release the slot back to the pool
    if (appt.slotId) {
      await tx.doctorSlot.update({ where: { id: appt.slotId }, data: { isBooked: false } });
    }
    await tx.appointment.update({
      where: { id: input.appointmentId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancellationReason: input.reason.trim(),
        slotId: null, // frees the UNIQUE so the slot can be rebooked
      },
    });

    await logAudit(actor, {
      action: "APPOINTMENT_CANCELLED", targetTable: "Appointment", targetId: input.appointmentId,
      meta: { opNumber: appt.opNumber, reason: input.reason.trim() }, ...ctx,
    }, tx);

    // Warn the desk if money already changed hands. We do NOT auto-refund.
    type InvRow = { receiptNo: string; payments: { amount: { toString(): string } }[] };
    const paid = (appt.invoices as InvRow[])
      .map((i: InvRow) => ({
        receiptNo: i.receiptNo,
        amountPaid: i.payments.reduce((s: number, p: { amount: { toString(): string } }) => s + Number(p.amount.toString()), 0),
      }))
      .find((i: { amountPaid: number }) => i.amountPaid > 0);

    return {
      id: appt.id,
      opNumber: appt.opNumber,
      paidInvoice: paid ? { receiptNo: paid.receiptNo, amountPaid: paid.amountPaid.toFixed(2) } : null,
      patient: appt.patient,
      visitDate: appt.visitDate,
    };
  });

  // A cancelled visit has to leave the doctor's queue too, or they call for a
  // patient who went home.
  await announceVisitChange();

  // The one notification whose ABSENCE costs the patient a morning: without it
  // they travel in for a visit that no longer exists. Sent after the commit, so
  // a provider outage cannot leave the slot locked to a cancelled booking.
  await notifyOpCancelled(result.patient.phone, {
    name: result.patient.fullName,
    opNumber: result.opNumber,
    date: result.visitDate,
  });

  return {
    id: result.id,
    opNumber: result.opNumber,
    paidInvoice: result.paidInvoice,
  };
}

/**
 * Move a visit to a different slot with the SAME doctor.
 *
 * Same doctor only, deliberately: the consultation fee was snapshotted at booking
 * and may already be billed. Moving to a different doctor could silently change
 * what the patient owes. If they want another doctor, cancel and rebook - that
 * makes the money decision explicit instead of hiding it inside a reschedule.
 *
 * The new slot is claimed with the same atomic updateMany used at booking, so two
 * receptionists racing for the same slot can't both win.
 */
export async function rescheduleAppointment(
  actor: AuthUser,
  input: { appointmentId: string; newSlotId: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; opNumber: string; visitDate: string; time: string }> {
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const appt = await tx.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { id: true, opNumber: true, status: true, slotId: true, doctorId: true },
    });
    if (!appt) throw new ApiError(404, "Appointment not found");
    if (appt.status === "COMPLETED") throw new ApiError(409, "This visit is already complete");
    if (appt.status === "CANCELLED") throw new ApiError(409, "This visit was cancelled - book a new one");
    // Same-doctor-only is the whole rule below, and a casualty case has no
    // doctor to match against. Say that, instead of "pick the same doctor".
    if (!appt.doctorId) {
      throw new ApiError(400, "An emergency visit has no doctor or slot to move. Book a regular appointment instead.");
    }

    const slot = await tx.doctorSlot.findUnique({
      where: { id: input.newSlotId },
      select: { id: true, doctorId: true, date: true, startTime: true, isBooked: true },
    });
    if (!slot) throw new ApiError(404, "That slot doesn't exist");
    if (slot.doctorId !== appt.doctorId) {
      throw new ApiError(400, "Pick a slot with the same doctor. To change doctor, cancel and book again.");
    }
    if (slot.id === appt.slotId) throw new ApiError(400, "That's the slot it's already in");

    // atomic claim - identical guarantee to booking
    const claim = await tx.doctorSlot.updateMany({
      where: { id: slot.id, isBooked: false }, data: { isBooked: true },
    });
    if (claim.count === 0) throw new ApiError(409, "That slot was just taken. Please pick another.");

    // release the old one
    if (appt.slotId) {
      await tx.doctorSlot.update({ where: { id: appt.slotId }, data: { isBooked: false } });
    }

    await tx.appointment.update({
      where: { id: appt.id },
      data: {
        slotId: slot.id,
        visitDate: slot.date,
        timeAtBooking: slot.startTime,
        status: "BOOKED",   // if they'd checked in, arrival no longer applies
        checkedInAt: null,
      },
    });

    await logAudit(actor, {
      action: "APPOINTMENT_RESCHEDULED", targetTable: "Appointment", targetId: appt.id,
      meta: { opNumber: appt.opNumber, to: `${slot.date.toISOString().slice(0, 10)} ${slot.startTime}` }, ...ctx,
    }, tx);

    return {
      id: appt.id, opNumber: appt.opNumber,
      visitDate: slot.date.toISOString().slice(0, 10), time: slot.startTime,
    };
  });

  await announceVisitChange();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR AVAILABILITY - leave / surgery / emergency.
// Without this, a doctor could be on leave and reception would keep selling
// their slots. The patient arrives to an empty room.
// ─────────────────────────────────────────────────────────────────────────────

export interface DaySlot {
  id: string; startTime: string; endTime: string;
  state: "FREE" | "BOOKED" | "BLOCKED";
  blockReason: string | null;
  appointment: { id: string; opNumber: string; status: string; patient: { displayId: string; fullName: string; phone: string } } | null;
}

/** Every slot for one doctor on one day, whatever its state. */
export async function doctorDaySchedule(doctorId: string, date: string): Promise<{
  doctor: { id: string; name: string; department: string };
  onLeave: boolean;
  slots: DaySlot[];
}> {
  const day = new Date(date);
  if (Number.isNaN(day.getTime())) throw new ApiError(400, "Invalid date");
  day.setHours(0, 0, 0, 0);

  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId }, select: { id: true, name: true, department: true },
  });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const rows = await prisma.doctorSlot.findMany({
    where: { doctorId, date: day },
    orderBy: { startTime: "asc" },
    select: {
      id: true, startTime: true, endTime: true, isBooked: true, isBlocked: true, blockReason: true,
      appointment: {
        select: {
          id: true, opNumber: true, status: true,
          patient: { select: { displayId: true, fullName: true, phone: true } },
        },
      },
    },
  });

  type Row = {
    id: string; startTime: string; endTime: string; isBooked: boolean; isBlocked: boolean; blockReason: string | null;
    appointment: { id: string; opNumber: string; status: string; patient: { displayId: string; fullName: string; phone: string } } | null;
  };

  const slots: DaySlot[] = (rows as Row[]).map((s) => ({
    id: s.id, startTime: s.startTime, endTime: s.endTime,
    state: s.isBlocked ? "BLOCKED" : s.isBooked ? "BOOKED" : "FREE",
    blockReason: s.blockReason,
    appointment: s.appointment,
  }));

  // "On leave" = there are slots, and none of them are still sellable.
  const sellable = slots.filter((s) => s.state === "FREE").length;
  return { doctor, onLeave: slots.length > 0 && sellable === 0 && slots.some((s) => s.state === "BLOCKED"), slots };
}

/**
 * Mark a doctor unavailable for a day.
 *
 * Blocks every FREE slot. Slots that are already BOOKED are deliberately left
 * alone - cancelling a patient's visit behind their back would be worse than the
 * problem. Instead we hand the caller the list of affected patients (with phone
 * numbers) so the desk can ring them and reschedule or cancel, one by one, on
 * purpose.
 */
export async function setDoctorLeave(
  actor: AuthUser,
  input: { doctorId: string; date: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{
  blocked: number;
  affected: { id: string; opNumber: string; time: string; patient: { displayId: string; fullName: string; phone: string } }[];
}> {
  if (!input.reason?.trim()) throw new ApiError(400, "Give a reason (leave, surgery, emergency…)");
  const day = new Date(input.date);
  if (Number.isNaN(day.getTime())) throw new ApiError(400, "Invalid date");
  day.setHours(0, 0, 0, 0);

  const res = await prisma.doctorSlot.updateMany({
    where: { doctorId: input.doctorId, date: day, isBooked: false, isBlocked: false },
    data: { isBlocked: true, blockReason: input.reason.trim() },
  });

  // Who already holds a booking on this day? They need a phone call.
  const booked = await prisma.appointment.findMany({
    where: { doctorId: input.doctorId, visitDate: day, status: { in: ["BOOKED", "CHECKED_IN"] } },
    orderBy: { timeAtBooking: "asc" },
    select: {
      id: true, opNumber: true, timeAtBooking: true,
      patient: { select: { displayId: true, fullName: true, phone: true } },
    },
  });

  await logAudit(actor, {
    action: "DOCTOR_LEAVE_SET", targetTable: "Doctor", targetId: input.doctorId,
    meta: { date: input.date, reason: input.reason.trim(), blocked: res.count, alreadyBooked: booked.length },
    ...ctx,
  });

  type B = { id: string; opNumber: string; timeAtBooking: string; patient: { displayId: string; fullName: string; phone: string } };
  return {
    blocked: res.count,
    affected: (booked as B[]).map((b) => ({
      id: b.id, opNumber: b.opNumber, time: b.timeAtBooking, patient: b.patient,
    })),
  };
}

/** Doctor is back. Blocked slots become sellable again. */
export async function clearDoctorLeave(
  actor: AuthUser,
  input: { doctorId: string; date: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ reopened: number }> {
  const day = new Date(input.date);
  if (Number.isNaN(day.getTime())) throw new ApiError(400, "Invalid date");
  day.setHours(0, 0, 0, 0);

  const res = await prisma.doctorSlot.updateMany({
    where: { doctorId: input.doctorId, date: day, isBlocked: true },
    data: { isBlocked: false, blockReason: null },
  });

  await logAudit(actor, {
    action: "DOCTOR_LEAVE_CLEARED", targetTable: "Doctor", targetId: input.doctorId,
    meta: { date: input.date, reopened: res.count }, ...ctx,
  });
  return { reopened: res.count };
}

/** Block or reopen ONE slot - the doctor stepped out for an hour, not the day. */
export async function toggleSlotBlock(
  actor: AuthUser,
  input: { slotId: string; blocked: boolean; reason?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const slot = await prisma.doctorSlot.findUnique({
    where: { id: input.slotId }, select: { id: true, isBooked: true },
  });
  if (!slot) throw new ApiError(404, "Slot not found");
  if (slot.isBooked) throw new ApiError(409, "That slot has a patient in it - reschedule or cancel the visit first");

  await prisma.doctorSlot.update({
    where: { id: input.slotId },
    data: input.blocked
      ? { isBlocked: true, blockReason: input.reason?.trim() || "Unavailable" }
      : { isBlocked: false, blockReason: null },
  });
  await logAudit(actor, {
    action: input.blocked ? "SLOT_BLOCKED" : "SLOT_REOPENED",
    targetTable: "DoctorSlot", targetId: input.slotId, ...ctx,
  });
}
/**
 * DOCTOR PROFILES, MANAGED FROM THE FRONT DESK.
 *
 * WHY NOT JUST GIVE RECEPTION `/admin/staff`. That endpoint creates and edits
 * USER ACCOUNTS of any role - it is how an ADMIN is made. Widening it so the
 * desk could fix a spelling in a consultant's qualification would have handed
 * reception the ability to mint administrators, which is the exact trade the
 * Role enum's own note refuses.
 *
 * So this touches the Doctor row and nothing else. `Doctor.userId` is nullable
 * on purpose, and that is what makes this safe: a doctor added here is a
 * PROFILE - bookable, billable, on the roster - with no login behind it. A
 * consultant who needs to sign in still needs an account, and accounts are
 * still admin's.
 */
export async function createDoctorProfile(
  actor: AuthUser,
  input: {
    name: string; specialization: string; department: string; consultationFee: number;
    registrationNo?: string;
    qualification?: string; experienceYears?: number; age?: number;
    languages?: string; photoUrl?: string; bio?: string;
  },
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<{ id: string; name: string }> {
  const name = input.name.trim();
  if (!name) throw new ApiError(400, "Name the doctor");

  const doctor = await prisma.$transaction(async (tx) => {
    const d = await tx.doctor.create({
      data: {
        name,
        specialization: input.specialization.trim(),
        department: input.department.trim(),
        consultationFee: input.consultationFee.toFixed(2),
        registrationNo: input.registrationNo?.trim() || null,
        qualification: input.qualification?.trim() || null,
        experienceYears: input.experienceYears ?? null,
        age: input.age ?? null,
        languages: input.languages?.trim() || null,
        photoUrl: input.photoUrl?.trim() || null,
        bio: input.bio?.trim() || null,
      },
      select: { id: true, name: true },
    });

    // WITHOUT A DIARY A DOCTOR CANNOT BE BOOKED. The same round-the-clock
    // schedule admin gives a new consultant - DIARY_* lives in slots.service now,
    // so the two paths cannot drift apart again. A doctor added here who then
    // does not appear on the booking screen would read as this page not working.
    //
    // THE RETURN TYPE ON THE CALLBACK IS THE REPAIR, and where it sits is the
    // whole point. This wrote `slotMinutes`, which is not a column -
    // DoctorSchedule spells it `slotDurationMin` - and nothing caught it:
    // `.map()` infers its element type FROM the callback, so the literal was
    // never checked against anything and the excess-property check had nothing
    // to fire on. The unknown argument went to Prisma, which rejects one
    // outright, and the transaction failed every time. From the day this screen
    // shipped, reception could not add a doctor AT ALL, while admin - which had
    // the name right - could.
    //
    // Annotating the ARRAY does not fix it; inference still runs outwards from
    // the callback and tsc stays quiet. Annotating the callback's RETURN does -
    // the literal is checked as written, and the same typo is a compile error
    // rather than a save button that quietly refuses.
    const diary = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek): Prisma.DoctorScheduleCreateManyInput => ({
      doctorId: d.id, dayOfWeek,
      startTime: DIARY_START, endTime: DIARY_END, slotDurationMin: DIARY_SLOT_MIN,
    }));
    await tx.doctorSchedule.createMany({ data: diary });
    return d;
  });

  // ── A DIARY IS NOT YET A BOOKABLE GRID ──
  //
  // DoctorSchedule is the template; DoctorSlot is what the booking screen
  // actually offers. Admin generates the slots the moment it creates a
  // consultant and this did not - so even with the write above fixed, a doctor
  // added here would sit on the roster with no times against them, bookable
  // from nowhere until somebody happened to press Regenerate.
  //
  // AFTER the transaction, for the reason admin does it after its own: a
  // round-the-clock horizon is tens of thousands of rows, and holding a
  // transaction open across them blocks the table. A doctor with a diary and no
  // slots yet is recoverable; a half-created doctor is not. So a failure here is
  // logged rather than thrown - the doctor exists and is correct, and only the
  // grid is missing.
  try {
    await generateSlots(SLOT_HORIZON_DAYS, doctor.id);
  } catch (e) {
    console.error("[reception] doctor created but slot generation failed:", e);
  }

  await logAudit(actor, {
    action: "DOCTOR_CREATED", targetTable: "Doctor", targetId: doctor.id,
    meta: { name: doctor.name, department: input.department, fee: input.consultationFee }, ...ctx,
  });
  return doctor;
}

/** Edit a doctor's own details. Never their login - see createDoctorProfile. */
export async function updateDoctorProfile(
  actor: AuthUser,
  doctorId: string,
  input: {
    name?: string; specialization?: string; department?: string; consultationFee?: number;
    registrationNo?: string;
    qualification?: string; experienceYears?: number; age?: number;
    languages?: string; photoUrl?: string; bio?: string; active?: boolean;
  },
  ctx: { ipAddress?: string; userAgent?: string },
): Promise<void> {
  const before = await prisma.doctor.findUnique({
    where: { id: doctorId },
    select: { id: true, name: true, consultationFee: true, department: true, active: true },
  });
  if (!before) throw new ApiError(404, "Doctor not found");

  const str = (v?: string) => (v === undefined ? undefined : v.trim() || null);
  await prisma.doctor.update({
    where: { id: doctorId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.specialization !== undefined ? { specialization: input.specialization.trim() } : {}),
      ...(input.department !== undefined ? { department: input.department.trim() } : {}),
      ...(input.consultationFee !== undefined ? { consultationFee: input.consultationFee.toFixed(2) } : {}),
      // ONE BOX ADDS AND EDITS. `undefined` means the caller said nothing about
      // it and the stored value stands; an empty string means somebody cleared
      // it on purpose, and `str` turns that back into null.
      ...(input.registrationNo !== undefined ? { registrationNo: str(input.registrationNo) } : {}),
      ...(input.qualification !== undefined ? { qualification: str(input.qualification) } : {}),
      ...(input.experienceYears !== undefined ? { experienceYears: input.experienceYears } : {}),
      ...(input.age !== undefined ? { age: input.age } : {}),
      ...(input.languages !== undefined ? { languages: str(input.languages) } : {}),
      ...(input.photoUrl !== undefined ? { photoUrl: str(input.photoUrl) } : {}),
      ...(input.bio !== undefined ? { bio: str(input.bio) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });

  // THE FEE IS AUDITED BY ITS BEFORE AND AFTER, not just its new value. It is
  // what every future booking charges, and "who changed 400 to 900, and when"
  // is the question asked when a patient disputes a bill months later.
  const feeMoved = input.consultationFee !== undefined
    && Number(before.consultationFee) !== input.consultationFee;
  await logAudit(actor, {
    action: "DOCTOR_UPDATED", targetTable: "Doctor", targetId: doctorId,
    meta: {
      name: before.name,
      ...(feeMoved ? { feeFrom: Number(before.consultationFee), feeTo: input.consultationFee } : {}),
      ...(input.active !== undefined && input.active !== before.active ? { activeFrom: before.active, activeTo: input.active } : {}),
    }, ...ctx,
  });
}
