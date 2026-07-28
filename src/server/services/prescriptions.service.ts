import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { storeFile } from "@/lib/storage";
import { DUTY_DOCTOR } from "./appointments.service";
import { logAudit } from "./audit.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";

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

  const labs = (input.labs ?? []).map((s) => s.trim()).filter(Boolean);
  const clinical = {
    diagnosis: input.diagnosis?.trim() || null,
    advice: input.advice?.trim() || null,
    nextVisit: input.nextVisit?.trim() || null,
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
      labsAdvised: labs.length ? labs.join("\n") : null,
      nextVisit: clinical.nextVisit,
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
    action: input.sendNow ? "OPD_SHEET_SENT_TO_PHARMACY" : "OPD_SHEET_SAVED",
    targetTable: "PrescriptionUpload",
    targetId: row.id,
    meta: { patientId: appt.patientId, appointmentId: input.appointmentId, sheet: "live" },
    ...ctx,
  });

  return toDTO(row);
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
