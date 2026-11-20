import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { admissionSheet, updateAdmissionDoctor } from "@/server/services/ipd.service";
import { updateDoctorSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/**
 * Update the attending doctor on an IP admission.
 * Permitted for RECEPTIONIST, ADMIN, and INSURANCE_DESK.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, updateDoctorSchema);
  await updateAdmissionDoctor(actor, id, input, auditContext(req));
  // Returns updated admission sheet data so client state syncs cleanly
  return NextResponse.json(await admissionSheet(id));
});
