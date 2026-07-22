import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { opdPrintData } from "@/server/services/appointments.service";

export const dynamic = "force-dynamic";

/** Data bundle for the printed OPD prescription sheet. */
export const GET = handler(async (req, ctx) => {
  // Read-only OPD sheet - every staff portal can open it (pharmacy dispenses
  // from it, labs read the advised tests, doctor/reception review the visit).
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "PHARMACIST", "LAB_TECH");
  const { id } = await ctx.params;
  return NextResponse.json(await opdPrintData(id));
});
