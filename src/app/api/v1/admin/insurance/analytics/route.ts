import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { insuranceAnalytics } from "@/server/services/insurance.service";

export const dynamic = "force-dynamic";

/**
 * The owner's view of the insurance book. INSURANCE_DESK is on the guard too:
 * the desk chasing a TPA needs the ageing and the per-insurer record more than
 * anybody, and none of it is data they cannot already see one claim at a time.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN", "INSURANCE_DESK");
  return NextResponse.json(await insuranceAnalytics());
});
