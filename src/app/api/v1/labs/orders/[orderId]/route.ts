import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateLabOrder } from "@/server/services/labs.service";
import { updateLabOrderSchema } from "@/server/validators/labs";

export const dynamic = "force-dynamic";

/**
 * Correct an order already on the bench - who referred it, and the date it was
 * registered under.
 *
 * PATCH rather than PUT: the two fields are edited independently, and an absent
 * one has to mean "leave it alone" rather than "clear it". Reception can reach
 * it too - the desk that raised the order without a doctor on it is usually the
 * one holding the chit when the patient comes back.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN");
  const { orderId } = await ctx.params;
  const input = await parseBody(req, updateLabOrderSchema);
  const order = await updateLabOrder(actor, { orderId, ...input }, auditContext(req));
  return NextResponse.json({ order });
});
