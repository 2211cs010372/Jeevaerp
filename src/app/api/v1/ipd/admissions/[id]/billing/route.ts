import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { admissionSheet, correctStayBilling } from "@/server/services/ipd.service";
import { correctStaySchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/**
 * Correct what the stay is PRICED on - the dates, the bed rate, the nursing rate.
 *
 * INSURANCE_DESK is here for the same reason it is on the charge routes: a claim
 * is prepared against the payer's own tariff, and nursing and bed nights are the
 * two lines a TPA reprices most often. Same reach as the front desk over a stay's
 * money, and no further - they still cannot admit, discharge or take payment.
 *
 * DOCTOR is deliberately absent. Nothing here is clinical.
 *
 * The rules live in the service, not in this file: a discharged stay re-issues
 * its invoice through `updateInvoice`, which is where `billEditingEnabled`, the
 * IRN refusal and the money-already-collected floor are all enforced.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, correctStaySchema);
  await correctStayBilling(actor, id, input, auditContext(req));
  // The whole sheet back, not an { ok: true } - every figure the caller is
  // showing was derived from what just changed, and a screen that has to guess
  // the new day count is a screen that will get it wrong.
  return NextResponse.json(await admissionSheet(id));
});
