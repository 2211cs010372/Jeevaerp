import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateAdmissionNotes } from "@/server/services/ipd.service";
import { admissionNotesSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** Save the nursing / observation notes for an active stay. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const { notes } = await parseBody(req, admissionNotesSchema);
  const result = await updateAdmissionNotes(actor, id, notes, auditContext(req));
  return NextResponse.json(result);
});
