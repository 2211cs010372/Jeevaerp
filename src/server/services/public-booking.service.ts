import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { dateOnlyISO, parseLocalDate } from "@/lib/date";
import { logAudit } from "./audit.service";
import { toE164, phoneVariants } from "@/lib/phone";
import { getSettings } from "./admin.service";
import { sendOtpSms, sendAppointmentSms } from "@/lib/sms";
import {
  generateOtp, hashOtp, verifyOtp, maskPhone,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_RATE_WINDOW_MS, OTP_RATE_MAX,
} from "@/lib/auth/otp";
import type { Prisma } from "@prisma/client";

/**
 * PUBLIC BOOKING - the website writing into the ERP.
 *
 * This is the only unauthenticated endpoint in the system that creates rows,
 * so it is built defensively:
 *
 *  1. THE PHONE IS VERIFIED FIRST. Nothing is written until a one-time code
 *     sent to that number comes back. Without it, anyone could fill the diary
 *     with fake bookings, and - worse - fill the master patient index with
 *     junk records. Duplicate and fictional patients are a clinical safety
 *     problem, not just untidy data: a split history is how a ward ends up
 *     reading half of someone's allergies.
 *
 *  2. THE SLOT IS CLAIMED ATOMICALLY, with the same updateMany guard the
 *     reception desk uses. The website and the desk are booking the same
 *     diary; whoever commits first wins and the other is told plainly.
 *
 *  3. AN EXISTING PATIENT IS REUSED, matched on the verified phone. A family
 *     sharing one number is normal here, so the name is matched too before
 *     reusing a record - otherwise a mother booking for her son would attach
 *     the visit to her own file.
 *
 * The appointment is attributed to a service account (see systemBookingUser)
 * because Appointment.createdById is required and there is no staff member
 * behind an online booking. The audit row records the PATIENT as the actor,
 * which is the truth: they booked it.
 */

/**
 * Numbers are stored in E.164 ("+919876543210") - see lib/phone.ts. This is the
 * one shape written to the database and matched against it.
 */
const normalisePhone = toE164;

/**
 * The account online bookings are attributed to.
 *
 * isActive:false and no password hash, so it can never be logged into - every
 * auth path in auth.service rejects an inactive user. It exists purely to
 * satisfy the required createdById foreign key and to make "booked online"
 * visible in the desk's appointment list.
 */
async function systemBookingUser(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.user.findUnique({ where: { username: "system.online" }, select: { id: true } });
  if (existing) return existing.id;

  const created = await tx.user.create({
    data: {
      username: "system.online",
      name: "Online Booking",
      phone: "0000000000",
      role: "RECEPTIONIST",
      isActive: false,   // cannot authenticate - attribution only
      passwordHash: null,
    },
    select: { id: true },
  });
  return created.id;
}

/** The slot, with everything the confirmation message needs. */
async function loadBookableSlot(slotId: string) {
  const slot = await prisma.doctorSlot.findUnique({
    where: { id: slotId },
    select: {
      id: true, date: true, startTime: true, isBooked: true, isBlocked: true,
      doctor: { select: { id: true, name: true, department: true, consultationFee: true, active: true } },
    },
  });
  if (!slot) throw new ApiError(404, "That time is no longer on the board. Pick another.");
  if (!slot.doctor.active) throw new ApiError(400, "That doctor is not consulting online at the moment.");
  if (slot.isBlocked) throw new ApiError(409, "That time has been blocked. Please pick another.");
  if (slot.isBooked) throw new ApiError(409, "That time was just taken. Please pick another.");
  if (!slot.startTime) throw new ApiError(500, "That slot has no start time - please call the desk.");

  // Never let the website book something already in the past. slot.date is a
  // date-only column (UTC midnight); the clinic reads it as a LOCAL calendar
  // day, so rebuild the instant that way before comparing to the wall clock.
  const when = parseLocalDate(dateOnlyISO(slot.date));
  const [h, m] = slot.startTime.split(":").map(Number);
  when.setHours(h, m, 0, 0);
  if (when.getTime() < Date.now()) throw new ApiError(409, "That time has already passed. Pick a later one.");

  return slot;
}

// ===========================================================================
// Step 1 - prove the phone is yours
// ===========================================================================

/**
 * Online booking can be switched off by an admin - a hospital closing for a
 * fortnight should not be taking web appointments it cannot honour.
 *
 * Checked in the SERVICE, not the route, so BOTH steps are covered. Gating only
 * the "send OTP" call would leave anyone holding a valid code able to post
 * straight to step two and book against a switch that says the door is shut.
 */
async function assertBookingOpen(): Promise<void> {
  const { onlineBookingEnabled } = await getSettings();
  if (!onlineBookingEnabled) {
    throw new ApiError(503, "Online booking is closed right now. Please call the hospital to book an appointment.");
  }
}

export async function requestBookingOtp(input: {
  slotId: string; name: string; phone: string;
}): Promise<{ sentTo: string; expiresInMs: number }> {
  await assertBookingOpen();
  const phone = normalisePhone(input.phone);
  // toE164 returns "" for anything that is not a real Indian mobile, so an
  // empty result IS the validation failure. Never check .length against 10 -
  // the stored form is "+919876543210" and that test would reject every number.
  if (!phone) throw new ApiError(400, "Enter a 10-digit mobile number");

  // Fail early if the slot has gone, so nobody burns an SMS on a dead slot.
  await loadBookableSlot(input.slotId);

  // Rate limit per number, reusing the same window the login OTP uses.
  const since = new Date(Date.now() - OTP_RATE_WINDOW_MS);
  const recent = await prisma.otp.count({ where: { phone, createdAt: { gte: since } } });
  if (recent >= OTP_RATE_MAX) {
    throw new ApiError(429, "Too many codes requested. Please wait a few minutes, or call the desk to book.");
  }

  const code = generateOtp();
  await prisma.otp.create({
    data: {
      phone,
      destination: maskPhone(phone),
      codeHash: hashOtp(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await sendOtpSms(phone, code);
  return { sentTo: maskPhone(phone), expiresInMs: OTP_TTL_MS };
}

// ===========================================================================
// Step 2 - verify, then actually book
// ===========================================================================

export interface PublicBookingResult {
  opNumber: string;
  displayId: string;
  patientName: string;
  doctorName: string;
  department: string;
  date: string;
  time: string;
  fee: string;
  /** False when the SMS gateway didn't take it - the UI then says so. */
  smsSent: boolean;
  /** True when this phone+name was already registered here. */
  existingPatient: boolean;
}

export async function confirmBooking(
  input: { slotId: string; name: string; phone: string; code: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PublicBookingResult> {
  await assertBookingOpen();
  const phone = normalisePhone(input.phone);
  const name = input.name.trim().replace(/\s+/g, " ");
  // toE164 returns "" for anything that is not a real Indian mobile, so an
  // empty result IS the validation failure. Never check .length against 10 -
  // the stored form is "+919876543210" and that test would reject every number.
  if (!phone) throw new ApiError(400, "Enter a 10-digit mobile number");
  if (name.length < 2) throw new ApiError(400, "Enter the patient's name");

  // ── verify the code ──────────────────────────────────────────────────────
  const otp = await prisma.otp.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw new ApiError(400, "That code has expired. Ask for a new one.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many wrong attempts. Ask for a new code.");
  }
  if (!verifyOtp(input.code, otp.codeHash)) {
    await prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new ApiError(400, "That code isn't right. Check the message and try again.");
  }

  const slot = await loadBookableSlot(input.slotId);

  // ── one transaction: consume code, resolve patient, claim slot, book ─────
  const booked = await prisma.$transaction(async (tx) => {
    // Consume the code inside the transaction so a retry can't reuse it.
    const consumed = await tx.otp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new ApiError(400, "That code has already been used. Ask for a new one.");

    // A shared family number is normal, so match the NAME too before reusing
    // a record - otherwise a mother booking for her son lands on her own file.
    // Matched on EVERY stored shape, not just the canonical one. A patient
    // registered before the +91 migration still holds the bare ten digits, and
    // failing to find them here would silently create a duplicate record - a
    // split history is a clinical safety problem, not untidy data.
    const candidates = await tx.patient.findMany({
      where: { phone: { in: phoneVariants(phone) }, mergedIntoId: null, deletedAt: null },
      select: { id: true, displayId: true, fullName: true },
    });
    const match = candidates.find(
      (p) => p.fullName.trim().toLowerCase() === name.toLowerCase()
    );

    let patient = match;
    let isNew = false;
    if (!patient) {
      const [firstName, ...rest] = name.split(" ");
      const displayId = await nextId("PATIENT", { tx });
      patient = await tx.patient.create({
        data: {
          displayId,
          firstName,
          lastName: rest.length ? rest.join(" ") : null,
          fullName: name,
          phone,
          // Everything else is left blank deliberately. Reception completes the
          // record at the desk, where age, gender and address can be asked for
          // properly instead of guessed from a booking form.
        },
        select: { id: true, displayId: true, fullName: true },
      });
      isNew = true;
    }

    // Atomic claim - identical guard to the reception desk's path.
    const claim = await tx.doctorSlot.updateMany({
      where: { id: slot.id, isBooked: false, isBlocked: false },
      data: { isBooked: true },
    });
    if (claim.count === 0) throw new ApiError(409, "That time was just taken. Please pick another.");

    const createdById = await systemBookingUser(tx);
    const opNumber = await nextId("OP", { tx });

    const appt = await tx.appointment.create({
      data: {
        patientId: patient.id,
        doctorId: slot.doctor.id,
        slotId: slot.id,
        visitDate: slot.date,
        timeAtBooking: slot.startTime,
        type: "ONLINE",
        status: "BOOKED",
        opNumber,
        priceAtBooking: slot.doctor.consultationFee,
        createdById,
      },
      select: { id: true, opNumber: true },
    });

    // The patient is the actor here - they booked it, not a staff member.
    await logAudit(
      { id: patient.id, role: "PATIENT" },
      {
        action: "APPOINTMENT_BOOKED_ONLINE",
        targetTable: "Appointment",
        targetId: appt.id,
        meta: {
          opNumber, doctor: slot.doctor.name, newPatient: isNew,
          date: dateOnlyISO(slot.date), time: slot.startTime,
        },
        ...ctx,
      },
      tx
    );

    return { appt, patient, isNew };
  });

  // ── confirmation, after the row is safely committed ──────────────────────
  const dateLabel = slot.date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const sms = await sendAppointmentSms(phone, {
    name: booked.patient.fullName,
    opNumber: booked.appt.opNumber,
    doctor: slot.doctor.name,
    date: dateLabel,
    time: slot.startTime,
  });

  return {
    opNumber: booked.appt.opNumber,
    displayId: booked.patient.displayId,
    patientName: booked.patient.fullName,
    doctorName: slot.doctor.name,
    department: slot.doctor.department,
    date: dateOnlyISO(slot.date),
    time: slot.startTime,
    fee: slot.doctor.consultationFee.toString(),
    smsSent: sms.sent,
    existingPatient: !booked.isNew,
  };
}
