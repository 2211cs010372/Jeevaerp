import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { removeAdmissionCharge, updateAdmissionCharge } from "@/server/services/ipd.service";
import { updateChargeSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

export const DELETE = handler(async (req, ctx) => {
  // INSURANCE_DESK is here because a claim is prepared against a payer's own
  // tariff - see updateAdmissionCharge. Same reach as the front desk over a
  // stay's charges, and no further: they cannot admit, discharge or take money.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { chargeId } = await ctx.params;
  await removeAdmissionCharge(actor, chargeId, auditContext(req));
  return NextResponse.json({ ok: true });
});

/** Reprice / correct a line. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { chargeId } = await ctx.params;
  const input = await parseBody(req, updateChargeSchema);
  await updateAdmissionCharge(actor, chargeId, input, auditContext(req));
  return NextResponse.json({ ok: true });
});
