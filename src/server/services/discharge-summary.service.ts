import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { dischargeSummaryData } from "./ipd.service";
import type { AuthUser } from "@/lib/auth/types";

/**
 * THE DISCHARGE SUMMARY - one record, written from two desks.
 *
 * Reception and the insurance desk both need this document and both may type
 * into it. Everything here exists to keep that from becoming two documents.
 *
 * THE DOCUMENT IS TWO HALVES AND ONLY ONE IS STORED:
 *
 *   AUTOMATIC - who the patient is, which ward, which consultant, what was
 *   dispensed, which tests ran. Read through `admissionId` on every load from
 *   the records that already own it. Never copied into this table, because a
 *   copied patient name is a name that goes stale the first time somebody
 *   corrects a spelling.
 *
 *   MANUAL - the clinical narrative. Only a doctor can write a history of
 *   presenting illness, and nothing in this file ever generates one.
 *
 * The split is enforced by the shape of `saveDischargeSummary`: it accepts the
 * manual fields and nothing else, so no caller can push a patient name or a
 * medicine list into the stored row even by accident.
 */

/** Exactly the fields a person types. Anything absent is left alone. */
export interface DischargeSummaryInput {
  dischargeType?: string | null;
  diagnosis?: string | null;
  historyPresenting?: string | null;
  pastPersonalHistory?: string | null;
  clinicalFindings?: string | null;
  physicalExamination?: string | null;
  systemicExamination?: string | null;
  courseInHospital?: string | null;
  procedureNotes?: string | null;
  conditionAtDischarge?: string | null;
  followUpInstruction?: string | null;
  preventiveAdvice?: string | null;
  vitalTemp?: string | null;
  vitalPulse?: string | null;
  vitalBp?: string | null;
  vitalSpo2?: string | null;
  examCvs?: string | null;
  examRs?: string | null;
  examPa?: string | null;
  examCns?: string | null;
  /** YYYY-MM-DD, or null to clear. */
  followUpDate?: string | null;
}

const TEXT_FIELDS = [
  "dischargeType",
  "diagnosis", "historyPresenting", "pastPersonalHistory", "clinicalFindings",
  "physicalExamination", "systemicExamination", "courseInHospital", "procedureNotes",
  "conditionAtDischarge", "followUpInstruction", "preventiveAdvice",
  "vitalTemp", "vitalPulse", "vitalBp", "vitalSpo2",
  "examCvs", "examRs", "examPa", "examCns",
] as const;

const clean = (v: string | null | undefined): string | null | undefined => {
  if (v === undefined) return undefined;   // not sent - leave the column alone
  const t = (v ?? "").trim();
  return t.length ? t : null;              // sent empty - clear it
};

export interface DischargeSummaryDTO {
  id: string;
  admissionId: string;
  status: "DRAFT" | "COMPLETED";
  fields: Record<string, string | null>;
  followUpDate: string | null;
  createdBy: string;
  updatedBy: string | null;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  /** THE CONCURRENCY TOKEN. A save carrying a stale one is refused - see save. */
  updatedAt: string;
}

const toDTO = (r: {
  id: string; admissionId: string; status: string; followUpDate: Date | null;
  completedAt: Date | null; createdAt: Date; updatedAt: Date;
  createdBy: { name: string }; updatedBy: { name: string } | null; completedBy: { name: string } | null;
} & Record<string, unknown>): DischargeSummaryDTO => ({
  id: r.id,
  admissionId: r.admissionId,
  status: r.status as "DRAFT" | "COMPLETED",
  fields: Object.fromEntries(TEXT_FIELDS.map((f) => [f, (r[f] as string | null) ?? null])),
  followUpDate: r.followUpDate ? r.followUpDate.toISOString().slice(0, 10) : null,
  createdBy: r.createdBy.name,
  updatedBy: r.updatedBy?.name ?? null,
  completedBy: r.completedBy?.name ?? null,
  completedAt: r.completedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const withAuthors = {
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
  completedBy: { select: { name: true } },
} as const;

/** The admission must exist before anything is written against it. Every entry
 *  point runs this, so a client-supplied admissionId is never trusted. */
async function assertAdmission(admissionId: string): Promise<void> {
  const a = await prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true } });
  if (!a) throw new ApiError(404, "Admission not found");
}

/**
 * LOAD IT, OR OPEN A DRAFT.
 *
 * Both portals call exactly this, which is what makes "whoever opens it first
 * creates it, the other one sees the same row" true rather than aspirational.
 *
 * The create is guarded by the UNIQUE index on admissionId rather than by a
 * read-then-write check: two desks opening the same stay in the same second
 * would both see "no summary" and both insert. The second insert loses the race
 * at the database, and we re-read instead of failing - the user's intent was to
 * open the document, and the document now exists.
 */
export async function getOrCreateDischargeSummary(
  actor: AuthUser,
  admissionId: string
): Promise<DischargeSummaryDTO> {
  await assertAdmission(admissionId);

  const existing = await prisma.dischargeSummary.findUnique({
    where: { admissionId },
    include: withAuthors,
  });
  if (existing) return toDTO(existing);

  // ── SEEDED FROM WHAT THE STAY ALREADY KNOWS ──
  // A doctor has already typed a diagnosis and an advice line onto this stay's
  // prescriptions. Opening the summary with those boxes blank invites them to be
  // typed a second time, slightly differently, and then the two documents
  // disagree. Seeded, never locked: the stored field is the one that prints from
  // here on, and it is fully editable.
  let seed: { diagnosis: string | null; advice: string | null; dischargeType: string } = {
    diagnosis: null,
    advice: null,
    dischargeType: "Normal Discharge",
  };
  try {
    const derived = await dischargeSummaryData(admissionId);
    let dt = "Normal Discharge";
    if (derived.admission.status === "LAMA") dt = "Lama Discharge";
    else if (derived.admission.status === "EXPIRED") dt = "Death";
    else if (derived.admission.status === "TRANSFERRED_OUT") dt = "Refer to";
    seed = {
      diagnosis: derived.clinical.diagnosis?.trim() || null,
      advice: derived.clinical.advice?.trim() || null,
      dischargeType: dt,
    };
  } catch {
    // A stay with nothing filed yet is normal - open a blank draft.
  }

  try {
    const created = await prisma.dischargeSummary.create({
      data: {
        admissionId,
        createdById: actor.id,
        diagnosis: seed.diagnosis,
        followUpInstruction: seed.advice,
        dischargeType: seed.dischargeType,
      },
      include: withAuthors,
    });
    await logAudit(actor, {
      action: "DISCHARGE_SUMMARY_CREATED", targetTable: "DischargeSummary", targetId: created.id,
      meta: { admissionId },
    });
    return toDTO(created);
  } catch {
    // Lost the race - the other desk created it a moment ago. Theirs is the row.
    const now = await prisma.dischargeSummary.findUnique({
      where: { admissionId },
      include: withAuthors,
    });
    if (!now) throw new ApiError(500, "Couldn't open the discharge summary");
    return toDTO(now);
  }
}

/**
 * SAVE, UNLESS SOMEBODY ELSE GOT THERE FIRST.
 *
 * `expectedUpdatedAt` is the timestamp the client loaded. If the stored row has
 * moved on, the other desk has typed something since and a blind write would
 * erase it silently - which on a clinical document is the worst possible
 * outcome, because nobody can tell it happened by reading the result.
 *
 * Passing no timestamp is allowed and means "I know this is a blind write".
 * The forms always send one.
 */
export async function saveDischargeSummary(
  actor: AuthUser,
  admissionId: string,
  input: DischargeSummaryInput,
  expectedUpdatedAt?: string
): Promise<DischargeSummaryDTO> {
  await assertAdmission(admissionId);

  const current = await prisma.dischargeSummary.findUnique({
    where: { admissionId },
    select: { id: true, updatedAt: true },
  });
  if (!current) throw new ApiError(404, "No discharge summary for this admission yet");

  if (expectedUpdatedAt) {
    const seen = new Date(expectedUpdatedAt).getTime();
    // Millisecond equality, not >=: a client that loaded a NEWER row than the
    // database holds is a bug worth surfacing, not a save worth accepting.
    if (Number.isNaN(seen) || seen !== current.updatedAt.getTime()) {
      throw new ApiError(
        409,
        "This discharge summary was updated by another user. Reload it before saving, or your changes will overwrite theirs."
      );
    }
  }

  const data: Record<string, string | null | Date | undefined> = {};
  for (const f of TEXT_FIELDS) {
    const v = clean(input[f] as string | null | undefined);
    if (v !== undefined) data[f] = v;
  }
  if (input.followUpDate !== undefined) {
    data.followUpDate = input.followUpDate ? parseDateOnly(input.followUpDate) : null;
  }
  data.updatedById = actor.id;

  const saved = await prisma.dischargeSummary.update({
    where: { admissionId },
    data,
    include: withAuthors,
  });
  await logAudit(actor, {
    action: "DISCHARGE_SUMMARY_SAVED", targetTable: "DischargeSummary", targetId: saved.id,
    meta: { admissionId, fields: Object.keys(data).filter((k) => k !== "updatedById") },
  });
  return toDTO(saved);
}

/**
 * Mark it final.
 *
 * A COMPLETELY BLANK SUMMARY CANNOT BE COMPLETED. Beyond that the bar is
 * deliberately low: which fields a given hospital insists on varies, and a hard
 * requirement on eleven clinical boxes is how staff learn to type "NA" into all
 * of them. Diagnosis and condition at discharge are the two the document is
 * meaningless without.
 *
 * Completing does NOT close the stay, free the bed or raise the invoice. That is
 * the discharge-and-bill action on the ward screen, and conflating the two would
 * mean a typo in a summary could discharge a patient.
 */
export async function completeDischargeSummary(
  actor: AuthUser,
  admissionId: string,
  expectedUpdatedAt?: string
): Promise<DischargeSummaryDTO> {
  const current = await prisma.dischargeSummary.findUnique({
    where: { admissionId },
    select: { id: true, updatedAt: true, diagnosis: true, conditionAtDischarge: true, status: true },
  });
  if (!current) throw new ApiError(404, "No discharge summary for this admission yet");

  if (expectedUpdatedAt) {
    const seen = new Date(expectedUpdatedAt).getTime();
    if (Number.isNaN(seen) || seen !== current.updatedAt.getTime()) {
      throw new ApiError(409, "This discharge summary was updated by another user. Reload it before completing.");
    }
  }

  const missing = [
    !current.diagnosis?.trim() ? "a diagnosis" : null,
    !current.conditionAtDischarge?.trim() ? "the condition at discharge" : null,
  ].filter(Boolean);
  if (missing.length) {
    throw new ApiError(400, `Fill in ${missing.join(" and ")} before completing this summary.`);
  }

  const saved = await prisma.dischargeSummary.update({
    where: { admissionId },
    data: {
      status: "COMPLETED",
      completedById: actor.id,
      completedAt: new Date(),
      updatedById: actor.id,
    },
    include: withAuthors,
  });
  await logAudit(actor, {
    action: "DISCHARGE_SUMMARY_COMPLETED", targetTable: "DischargeSummary", targetId: saved.id,
    meta: { admissionId },
  });
  return toDTO(saved);
}

/** Back to draft, so a mistake on a completed summary can be corrected rather
 *  than worked around by writing a second document. */
export async function reopenDischargeSummary(
  actor: AuthUser,
  admissionId: string
): Promise<DischargeSummaryDTO> {
  const saved = await prisma.dischargeSummary.update({
    where: { admissionId },
    data: { status: "DRAFT", completedById: null, completedAt: null, updatedById: actor.id },
    include: withAuthors,
  }).catch(() => null);
  if (!saved) throw new ApiError(404, "No discharge summary for this admission yet");
  await logAudit(actor, {
    action: "DISCHARGE_SUMMARY_REOPENED", targetTable: "DischargeSummary", targetId: saved.id,
    meta: { admissionId },
  });
  return toDTO(saved);
}

/** "2026-08-09" in the server's own calendar, with no timezone shift. */
function parseDateOnly(s: string): Date {
  const p = s.split("-").map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) throw new ApiError(400, "Enter a valid follow-up date");
  return new Date(p[0], p[1] - 1, p[2]);
}
