import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { undoLastTransfer } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/**
 * Remove a bed transfer entered by mistake.
 *
 * Both desks: reception moves patients, and the insurance desk works the same
 * stay sheet - whichever of them notices the wrong bed should be able to fix it.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  return NextResponse.json(await undoLastTransfer(actor, id, auditContext(req)));
});
