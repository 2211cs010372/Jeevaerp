import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { recentDischarges } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/** Recently discharged stays with their final IPD invoice, for re-printing bills. */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  return NextResponse.json({ discharges: await recentDischarges() });
});
