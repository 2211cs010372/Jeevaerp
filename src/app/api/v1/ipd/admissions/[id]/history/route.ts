import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { admissionHistory } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/** Billings, lab reports and prescription / pharmacy history for the stay's patient. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR");
  const { id } = await ctx.params;
  return NextResponse.json(await admissionHistory(id));
});
