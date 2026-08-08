import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { counterDues } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/**
 * Everything patients still owe across the counters, grouped per inpatient.
 *
 * The front desk is where a lab bill is actually settled - the collection window
 * takes no money - and it is where a family pays on the way out, in one amount,
 * for whatever the stay ran up. So this is deliberately NOT scoped to a source.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  return NextResponse.json(await counterDues());
});
