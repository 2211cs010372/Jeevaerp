import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { settleDues } from "@/server/services/billing.service";
import { settleDuesSchema } from "@/server/validators/reception";

export const dynamic = "force-dynamic";

/**
 * Take everything a patient owes in one go, allocated across their open bills.
 *
 * Reception is on this guard as well as the counters, because a lab bill is
 * settled at the front desk here - the lab window takes no money. See
 * settleDues for how the tender is spread over the invoices.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "RECEPTIONIST", "PHARMACIST", "ADMIN");
  const input = await parseBody(req, settleDuesSchema);
  const result = await settleDues(
    actor,
    { patientId: input.patientId, source: input.source, payments: input.payments },
    auditContext(req)
  );
  return NextResponse.json(result);
});
