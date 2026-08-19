import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { admitPatient, currentInpatients } from "@/server/services/ipd.service";
import { admitSchema } from "@/server/validators/ipd";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  // The insurance desk reads this list to find the stays it has to raise claims
  // for. Read-only for them: admitting is still reception's job below.
  //
  // PHARMACIST and LAB_TECH read it for the same reason: their counters pick an
  // inpatient off this list instead of typing a name. The ward sends down a
  // slip carrying a bed and an IP number, neither of which a patient search box
  // takes, so without this the technician works back to a name by hand and
  // sometimes lands on the wrong record. Reading who is in a bed is well short
  // of what either already sees on the stay they are billing to.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK", "PHARMACIST", "LAB_TECH");
  return NextResponse.json({ inpatients: await currentInpatients() });
});

/** Admit: patient by Jeeva ID, onto an AVAILABLE bed, under a doctor. */
export const POST = handler(async (req) => {
  // INSURANCE_DESK: this portal now runs the whole admission - the bed board,
  // the admit form and the stay sheet - so a patient can be booked in on a
  // policy without walking the family to reception first.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const i = await parseBody(req, admitSchema);
  const result = await admitPatient(actor, {
    patientDisplayId: i.patientDisplayId,
    bedId: i.bedId,
    doctorId: i.doctorId,
    reason: i.reason || undefined,
    attendantName: i.attendantName || undefined,
    attendantPhone: i.attendantPhone || undefined,
    attendantRelation: i.attendantRelation || undefined,
    notes: i.notes || undefined,
    payerType: i.payerType,
    insurer: i.insurer || undefined,
    policyNo: i.policyNo || undefined,
    memberId: i.memberId || undefined,
  }, auditContext(req));
  return NextResponse.json(result, { status: 201 });
});
