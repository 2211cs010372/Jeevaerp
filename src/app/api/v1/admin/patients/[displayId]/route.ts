import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getAdminPatientDetail } from "@/server/services/admin-patients.service";
import { updatePatient } from "@/server/services/reception.service";
import { updatePatientSchema } from "@/server/validators/reception";
import { auditContext } from "@/server/services/audit.service";

export const dynamic = "force-dynamic";

/** One patient in full, including the admin-only referral snapshot. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "ADMIN");
  const { displayId } = await ctx.params;
  return NextResponse.json(await getAdminPatientDetail(displayId.toUpperCase()));
});

/**
 * Edit a patient's registered details.
 *
 * Delegates to reception's `updatePatient` rather than reimplementing it: that
 * function is what recomputes fullName from the name parts, and a second copy
 * of that rule is a second place for search to silently break. Referral stays
 * uneditable there by design - it is a snapshot of what was true at
 * registration, and history that can be edited is not history.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { displayId } = await ctx.params;
  const input = await parseBody(req, updatePatientSchema);
  const patient = await updatePatient(actor, displayId.toUpperCase(), input, auditContext(req));
  return NextResponse.json({ patient });
});
