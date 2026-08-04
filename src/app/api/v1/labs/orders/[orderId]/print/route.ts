import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { labOrderReportData } from "@/server/services/labs.service";

export const dynamic = "force-dynamic";

/**
 * Every report on one order, for the sheet that prints them in one job.
 *
 * Same desks as the single-report route: the lab prints it, reception hands it
 * over the counter, the doctor reads it in the consulting room.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN", "DOCTOR");
  const { orderId } = await ctx.params;
  return NextResponse.json(await labOrderReportData(orderId));
});
