import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { dischargeSummaryData } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/** Data for the printable discharge summary - assembled from the stay. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR");
  const { id } = await ctx.params;
  return NextResponse.json(await dischargeSummaryData(id));
});
