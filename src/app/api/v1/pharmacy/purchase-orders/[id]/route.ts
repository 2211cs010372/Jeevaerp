import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { purchaseOrderDetail, updatePurchaseOrder } from "@/server/services/procurement.service";
import { updatePoSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ order: await purchaseOrderDetail(id) });
});

/** Draft edits only - the service refuses once the order is with the supplier. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  const i = await parseBody(req, updatePoSchema);
  await updatePurchaseOrder(actor, { id, ...i, notes: i.notes || undefined }, auditContext(req));
  return NextResponse.json({ ok: true });
});
