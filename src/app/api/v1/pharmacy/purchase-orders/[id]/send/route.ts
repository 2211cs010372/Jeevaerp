import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { sendPurchaseOrder } from "@/server/services/procurement.service";
export const dynamic = "force-dynamic";

/** Hand the order to the distributor. Its lines freeze from here. */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  await sendPurchaseOrder(actor, id, auditContext(req));
  return NextResponse.json({ ok: true });
});
