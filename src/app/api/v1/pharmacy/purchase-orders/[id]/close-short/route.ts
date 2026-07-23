import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { closePurchaseOrderShort } from "@/server/services/procurement.service";
import { cancelPoSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

/**
 * "The rest is never coming." Leaving a short-supplied order open makes the
 * reorder engine keep subtracting stock that will never arrive.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, cancelPoSchema);
  await closePurchaseOrderShort(actor, { id, reason }, auditContext(req));
  return NextResponse.json({ ok: true });
});
