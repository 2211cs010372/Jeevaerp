import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateDoctorProfile } from "@/server/services/appointments.service";
import { updateDoctorSchema } from "@/server/validators/doctor-profile";

export const dynamic = "force-dynamic";

/** Edit a doctor's own details. Their login, if they have one, is admin's. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, updateDoctorSchema);
  await updateDoctorProfile(actor, id, input, auditContext(req));
  return NextResponse.json({ ok: true });
});
