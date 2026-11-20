import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { deleteServiceCharge } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/**
 * Remove a service from the published rate card for good.
 * Refuses if the service has ever been charged on an inpatient admission,
 * advising the desk to retire/deactivate it instead.
 */
export const DELETE = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const { name } = await deleteServiceCharge(actor, id, auditContext(req));
  return NextResponse.json({ ok: true, name });
});
