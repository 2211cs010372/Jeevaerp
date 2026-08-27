import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { doctorPatientChart } from "@/server/services/doctor.service";
export const dynamic = "force-dynamic";
/** The patient chart. Read-only, and ADMIN reads it too - see doctorPatientChart. */
export const GET = handler(async (req, ctx) => {
  const actor = await requireRole(req, "DOCTOR", "ADMIN");
  const { displayId } = await ctx.params;
  return NextResponse.json(await doctorPatientChart(actor, displayId.toUpperCase()));
});
