import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { assignAppointmentDoctor } from "@/server/services/appointments.service";
import { assignDoctorSchema } from "@/server/validators/reception";

export const dynamic = "force-dynamic";

/**
 * Name the doctor who attended an emergency / casualty visit.
 *
 * Reception types back what the CMO wrote on the printed sheet's "Attended by"
 * line. Only fills a blank - the service refuses to move a visit that already
 * has a doctor.
 */
export const PUT = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, assignDoctorSchema);
  const result = await assignAppointmentDoctor(actor, { appointmentId: id, doctorId: input.doctorId }, auditContext(req));
  return NextResponse.json(result);
});
