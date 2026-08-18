import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { admissionHistory } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/** Billings, lab reports and prescription / pharmacy history for the stay's patient. */
export const GET = handler(async (req, ctx) => {
  // INSURANCE_DESK: the claims desk works the whole stay from its own portal -
  // the same sheet, the same corrections, the same record - so it needs the
  // same reads and writes reception has. Deliberately widened; see the role
  // note on the Role enum for why this one is granted field by field.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK");
  const { id } = await ctx.params;
  return NextResponse.json(await admissionHistory(id));
});
