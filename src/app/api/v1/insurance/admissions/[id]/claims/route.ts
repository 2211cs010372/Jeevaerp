import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { stayClaims } from "@/server/services/insurance.service";
import { revertBillsToSelfPay } from "@/server/services/billing.service";
import { revertToSelfPaySchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/** Where this stay stands with its insurer, and which bills are pointed there. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const { id } = await ctx.params;
  return NextResponse.json(await stayClaims(id));
});

/**
 * The insurer refused, so the patient is billed instead.
 *
 * Reception is on the guard because the desk that has to collect the money is
 * often the one told about the refusal - the family arrives at discharge with
 * the TPA's letter in hand.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const { id } = await ctx.params;
  const input = await parseBody(req, revertToSelfPaySchema);
  const result = await revertBillsToSelfPay(
    actor,
    { admissionId: id, invoiceIds: input.invoiceIds, reason: input.reason },
    auditContext(req)
  );
  return NextResponse.json(result);
});
