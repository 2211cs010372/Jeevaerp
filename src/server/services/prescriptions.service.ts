import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { storeFile } from "@/lib/storage";
import { DUTY_DOCTOR } from "./appointments.service";
import { logAudit } from "./audit.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";
import { advisedStatus, dedupeAdvisedNames, type AdvisedStatus } from "@/lib/advised-lab";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export interface PrescriptionUploadDTO {
  id: string;
  appointmentId: string | null;
  /** Null for a typed prescription (view its live OPD sheet at
   *  /print/opd/{appointmentId}); set only for a genuine scanned upload. */
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  title: string | null;
  status: string;
  createdAt: string;
  appointment: { opNumber: string; visitDate: string; doctorName: string } | null;
}

/**
 * Reception uploads a scanned prescription. Validates type/size, stores the
 * file (Cloudinary or local), and records a row linked to BOTH the patient and
 * (optionally) the appointment - so the patient sees it in their profile by UHID.
 */
export async function uploadPrescription(
  actor: AuthUser,
  input: {
    patientId: string;
    appointmentId?: string;
  admissionId?: string;   // an INPATIENT Rx belongs to the stay, not a visit
    title?: string;
    /** Optional: a genuine scan. Omit it to file a TYPED prescription (medicines
     *  only, no image) - the pharmacy still gets the item list to dispense from. */
    file?: { buffer: Buffer; fileName: string; mimeType: string; size: number };
    /** Medicines transcribed by reception from the handwriting - this is what
     *  lets the pharmacy pre-pick before the patient reaches the counter. */
    items?: { medicineName: string; medicineId?: string; qty?: number; dosage?: string }[];
    /** Upload and dispatch to the pharmacy queue in one motion. */
    sendNow?: boolean;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PrescriptionUploadDTO> {
  if (input.file) {
    if (!ALLOWED.has(input.file.mimeType)) {
      throw new ApiError(400, "Only PDF, JPG, PNG or WebP files are allowed");
    }
    if (input.file.size > MAX_BYTES) {
      throw new ApiError(400, "File too large (max 10 MB)");
    }
  }

  // Patient must exist.
  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, mergedIntoId: true, deletedAt: true },
  });
  if (!patient || patient.mergedIntoId || patient.deletedAt) {
    throw new ApiError(404, "Patient not found");
  }

  // If an appointment is given, it must belong to this patient. We also
  // snapshot the doctor's name - that's whose handwriting this is.
  let doctorName: string | null = null;
  if (input.appointmentId) {
    const appt = await prisma.appointment.findUnique({
      where: { id: input.appointmentId },
      select: { patientId: true, doctor: { select: { name: true } } },
    });
    if (!appt || appt.patientId !== input.patientId) {
      throw new ApiError(400, "That appointment doesn't belong to this patient");
    }
    doctorName = appt.doctor?.name ?? DUTY_DOCTOR.name;
  }

  // An inpatient Rx hangs off the STAY. Same ownership check, same doctor
  // snapshot - this time the attending doctor whose round produced the chit.
  if (input.admissionId) {
    const adm = await prisma.admission.findUnique({
      where: { id: input.admissionId },
      select: { patientId: true, status: true, doctor: { select: { name: true } } },
    });
    if (!adm || adm.patientId !== input.patientId) {
      throw new ApiError(400, "That admission doesn't belong to this patient");
    }
    if (adm.status !== "ADMITTED") throw new ApiError(409, "That patient is already discharged");
    doctorName = adm.doctor.name;
  }

  const cleanItems = (input.items ?? [])
    .map((it) => ({
      medicineName: it.medicineName.trim(),
      medicineId: it.medicineId || null,
      qty: Math.max(1, Math.floor(it.qty ?? 1)),
      dosage: it.dosage?.trim() || null,
    }))
    .filter((it) => it.medicineName.length > 0);

  // A prescription with neither a scan nor a single medicine is nothing at all.
  if (!input.file && cleanItems.length === 0) {
    throw new ApiError(400, "Add a scan, or at least one medicine.");
  }

  const stored = input.file
    ? await storeFile(input.file.buffer, { fileName: input.file.fileName, mimeType: input.file.mimeType })
    : null;

  const row = await prisma.prescriptionUpload.create({
    data: {
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      admissionId: input.admissionId ?? null,
      fileUrl: stored?.fileUrl ?? null,
      storage: stored?.storage ?? "local",
      fileName: input.file?.fileName ?? null,
      mimeType: input.file?.mimeType ?? null,
      fileSize: input.file?.size ?? null,
      title: input.title?.trim() || null,
      uploadedById: actor.id,
      doctorName,
      ...(input.sendNow ? { status: "SENT_TO_PHARMACY", sentToPharmacyAt: new Date() } : {}),
      ...(cleanItems.length ? { items: { create: cleanItems } } : {}),
    },
    select: {
      id: true, appointmentId: true, fileUrl: true, fileName: true, mimeType: true, fileSize: true,
      title: true, status: true, createdAt: true,
      appointment: { select: { opNumber: true, visitDate: true, doctor: { select: { name: true } } } },
    },
  });

  await logAudit(actor, {
    action: input.sendNow ? "PRESCRIPTION_UPLOADED_AND_SENT" : "PRESCRIPTION_UPLOADED",
    targetTable: "PrescriptionUpload",
    targetId: row.id,
    meta: { patientId: input.patientId },
    ...ctx,
  });

  return toDTO(row);
}

function toDTO(row: {
  id: string; appointmentId: string | null;
  fileUrl: string | null; fileName: string | null; mimeType: string | null; fileSize: number | null;
  title: string | null;
  status: string; createdAt: Date;
  appointment: { opNumber: string; visitDate: Date; doctor: { name: string } | null } | null;
}): PrescriptionUploadDTO {
  return {
    id: row.id, appointmentId: row.appointmentId,
    fileUrl: row.fileUrl, fileName: row.fileName, mimeType: row.mimeType,
    fileSize: row.fileSize, title: row.title, status: row.status, createdAt: row.createdAt.toISOString(),
    appointment: row.appointment
      ? { opNumber: row.appointment.opNumber, visitDate: row.appointment.visitDate.toISOString().slice(0, 10), doctorName: row.appointment.doctor?.name ?? DUTY_DOCTOR.name }
      : null,
  };
}

/**
 * Send the OPD prescription *sheet itself* - no scan needed.
 *
 * Instead of asking reception to photograph the doctor's paper, this renders
 * the same OPD stationery they'd print (letterhead, patient block, vitals and
 * the typed medicines) into a proper PDF, files it against the patient + visit,
 * and - when sendNow - drops it straight into the pharmacy queue. Because the
 * record is linked to the patient by UHID, it's on the patient's own record too
 * (their copy). The old scan-upload path still exists; this just doesn't need it.
 */
export async function sendOpdSheetToPharmacy(
  actor: AuthUser,
  input: {
    appointmentId: string;
    items: { medicineName: string; medicineId?: string; qty?: number; dosage?: string }[];
    title?: string;
    sendNow?: boolean;
    diagnosis?: string;
    advice?: string;
    nextVisit?: string;
    caseHistory?: string;
    labs?: string[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PrescriptionUploadDTO> {
  // Ownership + a name to stamp on the sheet as "whose handwriting this is".
  const appt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      patientId: true,
      patient: { select: { mergedIntoId: true, deletedAt: true } },
      doctor: { select: { name: true } },
    },
  });
  if (!appt || appt.patient.mergedIntoId || appt.patient.deletedAt) {
    throw new ApiError(404, "Appointment not found");
  }

  const cleanItems = (input.items ?? [])
    .map((it) => ({
      medicineName: it.medicineName.trim(),
      medicineId: it.medicineId || null,
      qty: Math.max(1, Math.floor(it.qty ?? 1)),
      dosage: it.dosage?.trim() || null,
    }))
    .filter((it) => it.medicineName.length > 0);

  const labs = dedupeAdvisedNames(input.labs ?? []);

  // Resolve each against the lab master so reception can order it in one click.
  // An unmatched name is kept anyway with catalogId null: the doctor wrote it,
  // so it prints and it stays on the outstanding list - the catalog not
  // stocking a test is not a reason to lose the instruction.
  const matched = labs.length
    ? await prisma.labTestCatalog.findMany({
        where: { active: true, name: { in: labs, mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : [];
  const catalogByName = new Map(matched.map((c) => [c.name.trim().toLowerCase(), c.id]));

  const clinical = {
    diagnosis: input.diagnosis?.trim() || null,
    advice: input.advice?.trim() || null,
    nextVisit: input.nextVisit?.trim() || null,
    caseHistory: input.caseHistory?.trim() || null,
    labs,
  };

  // A typed prescription is DATA-ONLY - no generated PDF. The OPD sheet is
  // rendered live from these ℞ items + clinical fields by /print/opd/{id}
  // (opdPrintData reads this row back), so there's nothing to store as a file.
  const row = await prisma.prescriptionUpload.create({
    data: {
      patientId: appt.patientId,
      appointmentId: input.appointmentId,
      title: input.title?.trim() || null,
      uploadedById: actor.id,
      doctorName: appt.doctor?.name ?? DUTY_DOCTOR.name,
      diagnosis: clinical.diagnosis,
      advice: clinical.advice,
      nextVisit: clinical.nextVisit,
      caseHistory: clinical.caseHistory,
      ...(input.sendNow ? { status: "SENT_TO_PHARMACY", sentToPharmacyAt: new Date() } : {}),
      ...(cleanItems.length ? { items: { create: cleanItems } } : {}),
      // Advised tests are ROWS now, not newline text. That is what lets
      // reception order them in one click and lets any screen answer "which of
      // these was never ordered" - a question the old column could not be asked.
      ...(labs.length
        ? {
            advisedLabs: {
              create: labs.map((name) => ({
                testName: name,
                catalogId: catalogByName.get(name.toLowerCase()) ?? null,
              })),
            },
          }
        : {}),
    },
    select: {
      id: true, appointmentId: true, fileUrl: true, fileName: true, mimeType: true, fileSize: true,
      title: true, status: true, createdAt: true,
      appointment: { select: { opNumber: true, visitDate: true, doctor: { select: { name: true } } } },
    },
  });

  await logAudit(actor, {
    action: input.sendNow ? "OPD_SHEET_SENT_TO_PHARMACY" : "OPD_SHEET_SAVED",
    targetTable: "PrescriptionUpload",
    targetId: row.id,
    meta: { patientId: appt.patientId, appointmentId: input.appointmentId, sheet: "live" },
    ...ctx,
  });

  return toDTO(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// ADVISED TESTS - closing the loop between what the doctor asked for and what
// was actually ordered.
//
// The advice used to be newline text nobody could act on: if the tests were
// never re-typed into the lab screen, they simply did not happen, and there was
// no list anywhere showing the difference. In a hospital this size nobody
// downstream catches that - the doctor assumes it was done, and the result they
// are waiting on never arrives.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdvisedLabDTO {
  id: string;
  testName: string;
  /** Null when the lab master has no matching test - it cannot be one-click ordered. */
  catalogId: string | null;
  price: string | null;
  /** The order raised against this advice, if any. */
  labTestId: string | null;
  status: AdvisedStatus;
  declinedReason: string | null;
}

const advisedSelect = {
  id: true, testName: true, catalogId: true, labTestId: true,
  declinedAt: true, declinedReason: true,
  catalog: { select: { price: true } },
} as const;

type AdvisedRow = {
  id: string; testName: string; catalogId: string | null; labTestId: string | null;
  declinedAt: Date | null; declinedReason: string | null;
  catalog: { price: { toString(): string } } | null;
};

function toAdvisedDTO(r: AdvisedRow): AdvisedLabDTO {
  return {
    id: r.id,
    testName: r.testName,
    catalogId: r.catalogId,
    price: r.catalog ? r.catalog.price.toString() : null,
    labTestId: r.labTestId,
    status: advisedStatus(r),
    declinedReason: r.declinedReason,
  };
}

/** What the doctor advised on this visit, and what became of each line. */
export async function advisedLabsForAppointment(appointmentId: string): Promise<AdvisedLabDTO[]> {
  const rows = await prisma.prescriptionUploadLab.findMany({
    where: { upload: { appointmentId } },
    orderBy: { createdAt: "asc" },
    select: advisedSelect,
  });
  return (rows as AdvisedRow[]).map(toAdvisedDTO);
}

/**
 * Every advised test still waiting on someone, across the whole desk.
 *
 * This is the safety net the gap was really about. A per-visit list only helps
 * the person who happens to reopen that visit; the reason a test gets missed is
 * that nobody goes looking. Reception sees this on the prescriptions screen.
 */
export async function outstandingAdvisedLabs(limit = 50): Promise<{
  rows: {
    id: string; testName: string; catalogId: string | null; price: string | null;
    advisedAt: string;
    patient: { id: string; displayId: string; fullName: string };
    appointmentId: string | null;
    opNumber: string | null;
    doctorName: string | null;
  }[];
  count: number;
}> {
  // Mirrors isOutstanding() in lib/advised-lab.ts - the same rule, expressed as
  // a query. Keep the two in step.
  const where = { labTestId: null, declinedAt: null } as const;

  const [rows, count] = await Promise.all([
    prisma.prescriptionUploadLab.findMany({
      where,
      orderBy: { createdAt: "asc" }, // oldest first - that is the one going stale
      take: limit,
      select: {
        id: true, testName: true, catalogId: true, createdAt: true,
        catalog: { select: { price: true } },
        upload: {
          select: {
            appointmentId: true,
            patient: { select: { id: true, displayId: true, fullName: true } },
            appointment: { select: { opNumber: true, doctor: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.prescriptionUploadLab.count({ where }),
  ]);

  type Row = {
    id: string; testName: string; catalogId: string | null; createdAt: Date;
    catalog: { price: { toString(): string } } | null;
    upload: {
      appointmentId: string | null;
      patient: { id: string; displayId: string; fullName: string };
      appointment: { opNumber: string; doctor: { name: string } | null } | null;
    };
  };

  return {
    count,
    rows: (rows as Row[]).map((r) => ({
      id: r.id,
      testName: r.testName,
      catalogId: r.catalogId,
      price: r.catalog ? r.catalog.price.toString() : null,
      advisedAt: r.createdAt.toISOString(),
      patient: r.upload.patient,
      appointmentId: r.upload.appointmentId,
      opNumber: r.upload.appointment?.opNumber ?? null,
      doctorName: r.upload.appointment?.doctor?.name ?? null,
    })),
  };
}

/**
 * Take an advised test off the outstanding list WITHOUT ordering it.
 *
 * A reason is required. "Declined" with no reason is not a record - and an
 * outstanding list that can be silently emptied is worth nothing, because the
 * quickest way to clear it becomes the one that destroys the information.
 */
export async function declineAdvisedLab(
  actor: AuthUser,
  input: { id: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<AdvisedLabDTO> {
  const reason = input.reason.trim();
  if (!reason) throw new ApiError(400, "Say why the test isn't being done");

  const existing = await prisma.prescriptionUploadLab.findUnique({
    where: { id: input.id },
    select: { id: true, testName: true, labTestId: true, declinedAt: true },
  });
  if (!existing) throw new ApiError(404, "That advised test no longer exists");
  if (existing.labTestId) throw new ApiError(409, "That test has already been ordered");
  if (existing.declinedAt) throw new ApiError(409, "That test is already marked not needed");

  const row = await prisma.prescriptionUploadLab.update({
    where: { id: input.id },
    data: { declinedAt: new Date(), declinedReason: reason },
    select: advisedSelect,
  });

  await logAudit(actor, {
    action: "ADVISED_LAB_DECLINED", targetTable: "PrescriptionUploadLab", targetId: input.id,
    meta: { testName: existing.testName, reason }, ...ctx,
  });

  // The outstanding count in the sidebar just dropped - every desk showing it
  // has to agree, or two receptionists chase the same test.
  await publishLive([TOPICS.RECEPTION, TOPICS.ADMIN], EVENTS.LAB_ORDERED);

  return toAdvisedDTO(row as AdvisedRow);
}

/**
 * Link an order back to the advice it came from.
 *
 * Called by the labs service after the LabTest rows exist, inside the same
 * request. Deliberately forgiving: a link that fails must never fail the order
 * itself - the test being ordered is the thing that matters clinically, and an
 * unlinked advised row simply stays on the outstanding list where a human can
 * see it. Silently losing the ORDER to keep the bookkeeping tidy would be
 * exactly the wrong trade.
 */
export async function linkAdvisedLabs(
  pairs: { advisedLabId: string; labTestId: string }[]
): Promise<void> {
  for (const p of pairs) {
    try {
      // updateMany, so the "not already linked / not declined" guard is part of
      // the WHERE rather than a read-then-write that two receptionists ordering
      // the same advice at once could both pass.
      await prisma.prescriptionUploadLab.updateMany({
        where: { id: p.advisedLabId, labTestId: null, declinedAt: null },
        data: { labTestId: p.labTestId },
      });
    } catch {
      // Already linked, already declined, or gone. Not worth failing an order.
    }
  }
}

/** All uploaded prescriptions for a patient (newest first). */
export async function listPatientPrescriptions(patientId: string): Promise<PrescriptionUploadDTO[]> {
  const rows = await prisma.prescriptionUpload.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, appointmentId: true, fileUrl: true, fileName: true, mimeType: true, fileSize: true,
      title: true, status: true, createdAt: true,
      appointment: { select: { opNumber: true, visitDate: true, doctor: { select: { name: true } } } },
    },
  });
  return rows.map(toDTO);
}

/** Replace the file on an existing prescription upload (keeps the same record). */
export async function replacePrescriptionFile(
  actor: AuthUser,
  input: { id: string; title?: string; file?: { buffer: Buffer; fileName: string; mimeType: string; size: number } },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PrescriptionUploadDTO> {
  const existing = await prisma.prescriptionUpload.findUnique({ where: { id: input.id }, select: { id: true } });
  if (!existing) throw new ApiError(404, "Prescription not found");

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim() || null;

  if (input.file) {
    if (!ALLOWED.has(input.file.mimeType)) throw new ApiError(400, "Only PDF, JPG, PNG or WebP files are allowed");
    if (input.file.size > MAX_BYTES) throw new ApiError(400, "File too large (max 10 MB)");
    const stored = await storeFile(input.file.buffer, { fileName: input.file.fileName, mimeType: input.file.mimeType });
    data.fileUrl = stored.fileUrl;
    data.storage = stored.storage;
    data.fileName = input.file.fileName;
    data.mimeType = input.file.mimeType;
    data.fileSize = input.file.size;
  }
  if (Object.keys(data).length === 0) throw new ApiError(400, "Nothing to update");

  const row = await prisma.prescriptionUpload.update({
    where: { id: input.id },
    data,
    select: {
      id: true, appointmentId: true, fileUrl: true, fileName: true, mimeType: true, fileSize: true, title: true, status: true, createdAt: true,
      appointment: { select: { opNumber: true, visitDate: true, doctor: { select: { name: true } } } },
    },
  });
  await logAudit(actor, { action: "PRESCRIPTION_REPLACED", targetTable: "PrescriptionUpload", targetId: input.id, ...ctx });
  return toDTO(row);
}

/** Delete a prescription upload record (reception/admin). */
export async function deletePrescription(
  actor: AuthUser,
  id: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const existing = await prisma.prescriptionUpload.findUnique({ where: { id }, select: { id: true, patientId: true } });
  if (!existing) throw new ApiError(404, "Prescription not found");
  await prisma.prescriptionUpload.delete({ where: { id } });
  await logAudit(actor, { action: "PRESCRIPTION_DELETED", targetTable: "PrescriptionUpload", targetId: id, meta: { patientId: existing.patientId }, ...ctx });
}

/**
 * Dispatch a scanned handwritten prescription to the pharmacy queue.
 * This is the hand-off: the doctor wrote it on paper, reception scanned it,
 * and now the pharmacist can see it and dispense against it.
 */
export async function sendToPharmacy(
  actor: AuthUser,
  id: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const rx = await prisma.prescriptionUpload.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!rx) throw new ApiError(404, "Prescription not found");
  if (rx.status === "DISPENSED") throw new ApiError(400, "This prescription has already been dispensed");
  if (rx.status === "SENT_TO_PHARMACY") throw new ApiError(400, "This is already in the pharmacy queue");

  await prisma.prescriptionUpload.update({
    where: { id },
    data: { status: "SENT_TO_PHARMACY", sentToPharmacyAt: new Date() },
  });
  await logAudit(actor, { action: "RX_SENT_TO_PHARMACY", targetTable: "PrescriptionUpload", targetId: id, ...ctx });

  // The counter's queue moves the instant the desk sends it up - no refresh.
  // The depth is sent so the pharmacy tab can show the new count immediately;
  // it is a number about the hospital, not about any patient.
  const waiting = await prisma.prescriptionUpload.count({ where: { status: "SENT_TO_PHARMACY" } });
  await publishLive([TOPICS.PHARMACY, TOPICS.RECEPTION], EVENTS.PRESCRIPTION_QUEUED, waiting);
}

/** Pull a scan back out of the pharmacy queue (sent by mistake). */
export async function recallFromPharmacy(
  actor: AuthUser,
  id: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const rx = await prisma.prescriptionUpload.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!rx) throw new ApiError(404, "Prescription not found");
  if (rx.status === "DISPENSED") throw new ApiError(400, "Already dispensed - it can't be recalled");

  await prisma.prescriptionUpload.update({
    where: { id },
    data: { status: "UPLOADED", sentToPharmacyAt: null },
  });
  await logAudit(actor, { action: "RX_RECALLED", targetTable: "PrescriptionUpload", targetId: id, ...ctx });

  // A recall matters MORE than a send: the counter may be about to dispense
  // against a chit the desk has just pulled back.
  const waiting = await prisma.prescriptionUpload.count({ where: { status: "SENT_TO_PHARMACY" } });
  await publishLive([TOPICS.PHARMACY, TOPICS.RECEPTION], EVENTS.PRESCRIPTION_QUEUED, waiting);
}


/**
 * The patient's recent COMPLETED consultations - reception links the scan to
 * one of these so the record shows whose handwriting it is and which visit
 * it belongs to.
 */
export async function recentCompletedVisits(displayId: string): Promise<{
  id: string; opNumber: string; visitDate: string; doctorName: string; department: string;
}[]> {
  const patient = await prisma.patient.findUnique({
    where: { displayId: displayId.toUpperCase() },
    select: { id: true, mergedIntoId: true, deletedAt: true },
  });
  if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "Patient not found");

  const rows = await prisma.appointment.findMany({
    where: { patientId: patient.id, status: "COMPLETED" },
    orderBy: { visitDate: "desc" },
    take: 6,
    select: {
      id: true, opNumber: true, visitDate: true,
      doctor: { select: { name: true, department: true } },
    },
  });

  return rows.map((r: { id: string; opNumber: string; visitDate: Date; doctor: { name: string; department: string } | null }) => ({
    id: r.id,
    opNumber: r.opNumber,
    visitDate: r.visitDate.toISOString().slice(0, 10),
    doctorName: r.doctor?.name ?? DUTY_DOCTOR.name,
    department: r.doctor?.department ?? DUTY_DOCTOR.department,
  }));
}
