import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addForgottenBill } from "@/server/services/ipd.service";
import { forgottenBillSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** A new LAB or PHARMACY bill for something this stay was given and never billed. */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, forgottenBillSchema);
  return NextResponse.json(await addForgottenBill(actor, id, input, auditContext(req)), { status: 201 });
});
