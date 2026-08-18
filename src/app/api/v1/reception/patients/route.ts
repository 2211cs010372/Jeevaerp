import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { registerPatient, searchPatients } from "@/server/services/reception.service";
import { registerPatientSchema, patientSearchSchema } from "@/server/validators/reception";

export const dynamic = "force-dynamic";

/** Register a new patient → issues a real UHID, saves to DB. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "RECEPTIONIST", "PHARMACIST", "ADMIN");
  const input = await parseBody(req, registerPatientSchema);
  const patient = await registerPatient(actor, input, auditContext(req));
  return NextResponse.json({ patient }, { status: 201 });
});

/** Search patients by name / UHID / phone. */
export const GET = handler(async (req) => {
  // INSURANCE_DESK: this portal now runs the whole admission - the bed board,
  // the admit form and the stay sheet - so a patient can be booked in on a
  // policy without walking the family to reception first.
  await requireRole(req, "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "ADMIN", "INSURANCE_DESK");
  const { searchParams } = new URL(req.url);
  const { q, limit } = patientSearchSchema.parse({
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  const patients = await searchPatients(q, limit);
  return NextResponse.json({ patients });
});
