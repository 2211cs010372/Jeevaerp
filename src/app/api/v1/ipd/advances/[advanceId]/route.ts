import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateAdvance } from "@/server/services/ipd.service";
import { advanceEditSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/**
 * Correct a deposit slip - date, time, mode, reference, amount.
 *
 * Same three desks that may TAKE a deposit may fix one, and no more: the
 * pharmacy and the lab never touch an IPD advance. Whether the desk may edit
 * money documents at all is HospitalConfig.billEditingEnabled, checked inside
 * the service - a role on this line is not the permission.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { advanceId } = await ctx.params;
  const input = await parseBody(req, advanceEditSchema);
  return NextResponse.json(await updateAdvance(actor, { advanceId, ...input }, auditContext(req)));
});
