import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { advancePrintData } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/** Data bundle for the printed IPD advance / deposit receipt. */
export const GET = handler(async (req, ctx) => {
  // Read-only money acknowledgement. Reception issues and reprints it; billing
  // and admin need it when reconciling the day's cash against the ledger.
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { advanceId } = await ctx.params;
  return NextResponse.json(await advancePrintData(advanceId));
});
