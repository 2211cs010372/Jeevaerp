import { z } from "zod";

/**
 * Every field a person types on a discharge summary, and nothing else.
 *
 * The automatic half of the document - patient, ward, consultant, medicines,
 * investigations - is deliberately absent. It is read through the admission on
 * every load, so there is no key here a caller could use to push a stale
 * patient name or an invented medicine into the stored record.
 *
 * All optional: the form saves drafts, and a field the client did not send must
 * be left exactly as it is rather than blanked. An empty string is the explicit
 * "clear this" and the service treats it that way.
 */
const text = (max: number) => z.string().trim().max(max).nullish();

export const dischargeSummarySchema = z.object({
  // Clinical narrative. Generous caps - a course-in-hospital entry runs long,
  // and a truncated sentence on a medico-legal document is worse than a long one.
  diagnosis: text(2000),
  historyPresenting: text(4000),
  pastPersonalHistory: text(4000),
  clinicalFindings: text(4000),
  physicalExamination: text(4000),
  systemicExamination: text(4000),
  courseInHospital: text(8000),
  procedureNotes: text(4000),
  conditionAtDischarge: text(2000),
  followUpInstruction: text(2000),
  preventiveAdvice: text(2000),

  // Examination at admission. Short free text, not numbers: "Afbrile",
  // "98% ON RA", "S1, S2(+)", "WFND" are all real entries.
  vitalTemp: text(60),
  vitalPulse: text(60),
  vitalBp: text(60),
  vitalSpo2: text(60),
  examCvs: text(200),
  examRs: text(200),
  examPa: text(200),
  examCns: text(200),

  followUpDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish(),

  /// The updatedAt the client loaded. Drives optimistic concurrency - two desks
  /// write this record, and a save without it is a blind overwrite.
  expectedUpdatedAt: z.string().trim().optional(),
});

export const dischargeSummaryActionSchema = z.object({
  action: z.enum(["COMPLETE", "REOPEN"]),
  expectedUpdatedAt: z.string().trim().optional(),
});
