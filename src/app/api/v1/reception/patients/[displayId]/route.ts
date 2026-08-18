import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getPatientByDisplayId, updatePatient } from "@/server/services/reception.service";
import { updatePatientSchema } from "@/server/validators/reception";
import { auditContext } from "@/server/services/audit.service";

export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  // INSURANCE_DESK: this portal now runs the whole admission - the bed board,
  // the admit form and the stay sheet - so a patient can be booked in on a
  // policy without walking the family to reception first.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { displayId } = await ctx.params;
  const patient = await getPatientByDisplayId(displayId.toUpperCase());
  return NextResponse.json({ patient });
});

/** Edit a patient's registered details. Reception / admin. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { displayId } = await ctx.params;
  const input = await parseBody(req, updatePatientSchema);
  const patient = await updatePatient(actor, displayId.toUpperCase(), input, auditContext(req));
  return NextResponse.json({ patient });
});
