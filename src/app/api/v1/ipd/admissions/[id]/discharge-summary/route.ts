import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth/guard";
import { dischargeSummaryData } from "@/server/services/ipd.service";
import {
  getOrCreateDischargeSummary, saveDischargeSummary,
  completeDischargeSummary, reopenDischargeSummary,
} from "@/server/services/discharge-summary.service";
import {
  dischargeSummarySchema, dischargeSummaryActionSchema,
} from "@/server/validators/discharge-summary";

export const dynamic = "force-dynamic";

/**
 * ONE ROUTE, BOTH PORTALS.
 *
 * Reception and the insurance desk call exactly this. There is deliberately no
 * /reception/discharge-summary and no /insurance/discharge-summary: two routes
 * over one record is two places for the create-or-load rule to live, and they
 * drift within a month.
 *
 * The admission id comes off the URL and is never trusted - every service call
 * below re-reads the admission and 404s if it does not exist, so a client
 * cannot reach another stay's summary by editing the path.
 */

/** Who may touch a discharge summary. INSURANCE_DESK is on every verb here:
 *  the claims desk types into this document too, which is the whole point. */
const ROLES = ["RECEPTIONIST", "INSURANCE_DESK", "DOCTOR", "ADMIN"] as const;

/**
 * The whole document: the derived half (patient, stay, medicines,
 * investigations, bill) plus the stored half (the clinical narrative).
 *
 * `summary` is null when nobody has opened one yet - the screens show a
 * "Create discharge summary" state rather than an empty form pretending to be
 * a record.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, ...ROLES);
  const { id } = await ctx.params;
  const [derived, stored] = await Promise.all([
    dischargeSummaryData(id),
    // Read-only: a GET must never create a row. Opening a draft is a POST,
    // because it writes and because it records who opened it.
    prisma.dischargeSummary.findUnique({
      where: { admissionId: id },
      include: {
        createdBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
        completedBy: { select: { name: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ...derived,
    summary: stored
      ? {
          id: stored.id,
          admissionId: stored.admissionId,
          status: stored.status,
          fields: {
            diagnosis: stored.diagnosis, historyPresenting: stored.historyPresenting,
            pastPersonalHistory: stored.pastPersonalHistory, clinicalFindings: stored.clinicalFindings,
            physicalExamination: stored.physicalExamination, systemicExamination: stored.systemicExamination,
            courseInHospital: stored.courseInHospital, procedureNotes: stored.procedureNotes,
            conditionAtDischarge: stored.conditionAtDischarge, followUpInstruction: stored.followUpInstruction,
            preventiveAdvice: stored.preventiveAdvice,
            vitalTemp: stored.vitalTemp, vitalPulse: stored.vitalPulse,
            vitalBp: stored.vitalBp, vitalSpo2: stored.vitalSpo2,
            examCvs: stored.examCvs, examRs: stored.examRs,
            examPa: stored.examPa, examCns: stored.examCns,
            dischargeType: stored.dischargeType,
          },
          followUpDate: stored.followUpDate ? stored.followUpDate.toISOString().slice(0, 10) : null,
          createdBy: stored.createdBy.name,
          updatedBy: stored.updatedBy?.name ?? null,
          completedBy: stored.completedBy?.name ?? null,
          completedAt: stored.completedAt?.toISOString() ?? null,
          createdAt: stored.createdAt.toISOString(),
          updatedAt: stored.updatedAt.toISOString(),
        }
      : null,
  });
});

/** Open the summary - loads the existing record, or starts a draft. Idempotent
 *  by the unique index on admissionId, so both portals can call it freely. */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, ...ROLES);
  const { id } = await ctx.params;
  return NextResponse.json({ summary: await getOrCreateDischargeSummary(actor, id) });
});

/** Save the typed fields. Carries the loaded `updatedAt` so a save that would
 *  overwrite another desk's work is refused with a 409 instead. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, ...ROLES);
  const { id } = await ctx.params;
  const i = await parseBody(req, dischargeSummarySchema);
  const { expectedUpdatedAt, ...fields } = i;
  return NextResponse.json({
    summary: await saveDischargeSummary(actor, id, fields, expectedUpdatedAt),
  });
});

/** COMPLETE / REOPEN. Neither closes the stay, frees the bed nor raises the
 *  invoice - that is the discharge-and-bill action on the ward screen. */
export const PUT = handler(async (req, ctx) => {
  const actor = await requireRole(req, ...ROLES);
  const { id } = await ctx.params;
  const { action, expectedUpdatedAt } = await parseBody(req, dischargeSummaryActionSchema);
  const summary = action === "COMPLETE"
    ? await completeDischargeSummary(actor, id, expectedUpdatedAt)
    : await reopenDischargeSummary(actor, id);
  return NextResponse.json({ summary });
});
