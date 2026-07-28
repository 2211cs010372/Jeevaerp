import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { nextId } from "@/lib/ids";
import { parseDateOnly, dateOnlyISO } from "@/lib/date";
import { logAudit } from "./audit.service";
import { toE164, phoneVariants } from "@/lib/phone";
import { getSettings } from "./admin.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { sendOtpSms } from "@/lib/sms";
import {
  generateOtp, hashOtp, verifyOtp, maskPhone,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS, OTP_RATE_WINDOW_MS, OTP_RATE_MAX,
} from "@/lib/auth/otp";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

/**
 * APPOINTMENT REQUESTS - "please call me back".
 *
 * The site already has a slot-booking path that writes a confirmed visit. This
 * is the lighter door beside it: name, mobile, the doctor they want, and that
 * is all. Reception rings back and owns the diary.
 *
 * Why a separate table and not an Appointment with a "pending" status: an
 * Appointment holds a slot, a fee snapshot and an OP number, none of which
 * exist yet - and every queue, count and day-close figure in this system reads
 * Appointment. A pending row would quietly inflate all of them.
 *
 * The phone is verified by one-time code BEFORE the row is written, for the
 * same reason the slot path does it: this is an unauthenticated endpoint that
 * creates rows, and an unverified one is a queue anybody can flood. Unlike the
 * slot path, NO Patient record is created - an enquiry has not earned a place
 * in the master patient index, and reception creates the file properly at
 * registration where age, gender and address can actually be asked for.
 */

/** E.164 storage form, matching every other phone in the ERP. See lib/phone.ts. */
const normalisePhone = toE164;

const MAX_NOTE = 500;
const MAX_NAME = 80;

// ===========================================================================
// Step 1 - prove the phone is yours
// ===========================================================================

/**
 * Callback requests can be switched off by an admin. Checked in the service so
 * both OTP steps are covered - gating only step one would leave a held code able
 * to queue a request the desk has said it does not want.
 */
async function assertCallbacksOpen(): Promise<void> {
  const { callbackRequestsEnabled } = await getSettings();
  if (!callbackRequestsEnabled) {
    throw new ApiError(503, "Callback requests are closed right now. Please call the hospital directly.");
  }
}

export async function requestCallbackOtp(input: {
  phone: string;
}): Promise<{ sentTo: string; expiresInMs: number }> {
  await assertCallbacksOpen();
  const phone = normalisePhone(input.phone);
  // toE164 returns "" for anything that is not a real Indian mobile, so an
  // empty result IS the validation failure. Never check .length against 10 -
  // the stored form is "+919876543210" and that test would reject every number.
  if (!phone) throw new ApiError(400, "Enter a 10-digit mobile number");

  // Same window and ceiling as every other OTP path here, so one number cannot
  // be used to pump SMS cost by hopping between forms.
  const since = new Date(Date.now() - OTP_RATE_WINDOW_MS);
  const recent = await prisma.otp.count({ where: { phone, createdAt: { gte: since } } });
  if (recent >= OTP_RATE_MAX) {
    throw new ApiError(429, "Too many codes requested. Please wait a few minutes, or call the desk directly.");
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
// Step 2 - verify the code, then queue the request
// ===========================================================================

export interface CallbackRequestResult {
  refNo: string;
  patientName: string;
  doctorName: string | null;
  preferredDate: string | null;
  /** True when this number has asked before - the desk sees it too. */
  repeatCaller: boolean;
}

export async function submitCallbackRequest(
  input: { name: string; phone: string; code: string; doctorId?: string; preferredDate?: string; note?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<CallbackRequestResult> {
  await assertCallbacksOpen();
  const phone = normalisePhone(input.phone);
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
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

  // A named doctor must exist and still be practising - otherwise the desk gets
  // a request for someone who left, and has to ring back to say so.
  let doctor: { id: string; name: string } | null = null;
  if (input.doctorId?.trim()) {
    const found = await prisma.doctor.findUnique({
      where: { id: input.doctorId.trim() },
      select: { id: true, name: true, active: true },
    });
    if (!found || !found.active) throw new ApiError(404, "That doctor isn't available. Pick another, or leave it blank.");
    doctor = { id: found.id, name: found.name };
  }

  // Date-only column: UTC midnight of the calendar day (see lib/date.ts).
  let preferredDate: Date | null = null;
  if (input.preferredDate?.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.preferredDate)) throw new ApiError(400, "Invalid date");
    const d = parseDateOnly(input.preferredDate);
    if (Number.isNaN(d.getTime())) throw new ApiError(400, "Invalid date");
    preferredDate = d;
  }

  // Legacy rows may still be bare ten digits - count the caller either way.
  const priorCount = await prisma.appointmentRequest.count({ where: { phone: { in: phoneVariants(phone) } } });

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Consume the code inside the transaction so a double-submit cannot queue
    // the same request twice.
    const consumed = await tx.otp.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count === 0) throw new ApiError(400, "That code has already been used. Ask for a new one.");

    const refNo = await nextId("REQ", { tx });
    return tx.appointmentRequest.create({
      data: {
        refNo,
        patientName: name,
        phone,
        doctorId: doctor?.id ?? null,
        preferredDate,
        note: input.note?.trim().slice(0, MAX_NOTE) || null,
        ipAddress: ctx.ipAddress ?? null,
      },
      select: { id: true, refNo: true, patientName: true },
    });
  });

  // NO actor: the person who raised this deliberately has no patient record yet
  // (see the note at the top of this file). It previously passed the request's
  // OWN id as a patient id, which failed the foreign key and silently dropped
  // every audit row this endpoint ever tried to write.
  await logAudit(
    null,
    {
      action: "APPOINTMENT_REQUEST_RAISED",
      targetTable: "AppointmentRequest",
      targetId: created.id,
      meta: { refNo: created.refNo, doctorId: doctor?.id ?? null, repeat: priorCount > 0 },
      ...ctx,
    }
  );

  // Somebody on the website is waiting for a phone call. The desk's requests
  // screen should show it while they are still sitting there expecting it.
  // openRequestCount() is the same definition the desk's badge uses - counting
  // it a second way here is how two screens end up disagreeing.
  await publishLive([TOPICS.RECEPTION, TOPICS.ADMIN], EVENTS.CALLBACK_RAISED, await openRequestCount());

  return {
    refNo: created.refNo,
    patientName: created.patientName,
    doctorName: doctor?.name ?? null,
    preferredDate: preferredDate ? dateOnlyISO(preferredDate) : null,
    repeatCaller: priorCount > 0,
  };
}

// ===========================================================================
// Reception side
// ===========================================================================

export interface CallbackRequestDTO {
  id: string;
  refNo: string;
  patientName: string;
  phone: string;
  doctor: { id: string; name: string; department: string } | null;
  preferredDate: string | null;
  note: string | null;
  status: string;
  handledNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
  /** Other requests from this same number - a repeat caller is worth knowing. */
  priorRequests: number;
  /** The visit this became, once booked. */
  appointment: { id: string; opNumber: string } | null;
}

const requestSelect = {
  id: true, refNo: true, patientName: true, phone: true, preferredDate: true,
  note: true, status: true, handledNote: true, handledAt: true, createdAt: true,
  doctor: { select: { id: true, name: true, department: true } },
  handledBy: { select: { name: true } },
  appointment: { select: { id: true, opNumber: true } },
} as const;

type Row = {
  id: string; refNo: string; patientName: string; phone: string;
  preferredDate: Date | null; note: string | null; status: string;
  handledNote: string | null; handledAt: Date | null; createdAt: Date;
  doctor: { id: string; name: string; department: string } | null;
  handledBy: { name: string } | null;
  appointment: { id: string; opNumber: string } | null;
};

/**
 * The desk's queue. Open requests first and oldest-first within that, because
 * the person who has been waiting longest for a call back is the one to ring.
 */
export async function listCallbackRequests(opts: { status?: string; limit?: number } = {}): Promise<CallbackRequestDTO[]> {
  const where = opts.status && opts.status !== "ALL"
    ? { status: opts.status as Row["status"] }
    : {};

  const rows = await prisma.appointmentRequest.findMany({
    where: where as Prisma.AppointmentRequestWhereInput,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: opts.limit ?? 200,
    select: requestSelect,
  });

  // One grouped count rather than a query per row.
  const phones = [...new Set((rows as Row[]).map((r) => r.phone))];
  const counts = phones.length
    ? await prisma.appointmentRequest.groupBy({
        by: ["phone"], where: { phone: { in: phones } }, _count: true,
      })
    : [];
  const byPhone = new Map(counts.map((c) => [c.phone, c._count]));

  return (rows as Row[]).map((r) => ({
    id: r.id,
    refNo: r.refNo,
    patientName: r.patientName,
    phone: r.phone,
    doctor: r.doctor,
    preferredDate: r.preferredDate ? dateOnlyISO(r.preferredDate) : null,
    note: r.note,
    status: r.status,
    handledNote: r.handledNote,
    handledBy: r.handledBy?.name ?? null,
    handledAt: r.handledAt ? r.handledAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    priorRequests: Math.max(0, (byPhone.get(r.phone) ?? 1) - 1),
    appointment: r.appointment,
  }));
}

/** How many are still waiting for someone to ring - drives the sidebar badge. */
export async function openRequestCount(): Promise<number> {
  return prisma.appointmentRequest.count({ where: { status: { in: ["NEW", "CONTACTED"] } } });
}

/**
 * Move a request along. Reception records what happened; the note is kept even
 * on a close, because "number unreachable, tried 3 times" is the answer to
 * "why was this never booked".
 */
export async function updateCallbackRequest(
  actor: AuthUser,
  input: { id: string; status: "NEW" | "CONTACTED" | "BOOKED" | "CLOSED"; note?: string; appointmentId?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<CallbackRequestDTO> {
  const existing = await prisma.appointmentRequest.findUnique({
    where: { id: input.id },
    select: { id: true, refNo: true, status: true, appointmentId: true },
  });
  if (!existing) throw new ApiError(404, "That request no longer exists");

  // BOOKED is a claim about a real visit. Don't let it be set without one -
  // a queue that says "booked" with nothing behind it is worse than untouched.
  if (input.status === "BOOKED" && !input.appointmentId && !existing.appointmentId) {
    throw new ApiError(400, "Book the appointment first - then this closes itself.");
  }

  if (input.appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: input.appointmentId }, select: { id: true },
    });
    if (!appt) throw new ApiError(404, "That appointment doesn't exist");
    // The unique index on appointmentId is the real guard; this is the polite
    // error the desk sees instead of a constraint violation.
    const taken = await prisma.appointmentRequest.findUnique({
      where: { appointmentId: input.appointmentId }, select: { id: true },
    });
    if (taken && taken.id !== existing.id) throw new ApiError(409, "That appointment is already linked to another request");
  }

  await prisma.appointmentRequest.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      handledNote: input.note?.trim().slice(0, MAX_NOTE) || undefined,
      handledById: actor.id,
      handledAt: new Date(),
      ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
    },
  });

  await logAudit(actor, {
    action: "APPOINTMENT_REQUEST_UPDATED",
    targetTable: "AppointmentRequest",
    targetId: existing.id,
    meta: { refNo: existing.refNo, from: existing.status, to: input.status },
    ...ctx,
  });

  return getCallbackRequest(existing.id);
}

/** One request, in the same shape the queue uses. */
export async function getCallbackRequest(id: string): Promise<CallbackRequestDTO> {
  const r = await prisma.appointmentRequest.findUnique({ where: { id }, select: requestSelect });
  if (!r) throw new ApiError(404, "That request no longer exists");
  const row = r as Row;
  const priorRequests = await prisma.appointmentRequest.count({
    where: { phone: row.phone, id: { not: row.id } },
  });
  return {
    id: row.id,
    refNo: row.refNo,
    patientName: row.patientName,
    phone: row.phone,
    doctor: row.doctor,
    preferredDate: row.preferredDate ? dateOnlyISO(row.preferredDate) : null,
    note: row.note,
    status: row.status,
    handledNote: row.handledNote,
    handledBy: row.handledBy?.name ?? null,
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    priorRequests,
    appointment: row.appointment,
  };
}
