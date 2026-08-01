import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { labReportData } from "@/server/services/labs.service";

export const dynamic = "force-dynamic";

/**
 * Data bundle for the printed lab report sheet.
 *
 * Read-only, and open to the same desks as the OPD sheet: the lab prints it,
 * reception hands it over the counter, the doctor reads it in the consulting
 * room. A report the ward can't open is a report that gets photocopied instead.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN", "DOCTOR");
  const { id } = await ctx.params;
  return NextResponse.json(await labReportData(id));
});
