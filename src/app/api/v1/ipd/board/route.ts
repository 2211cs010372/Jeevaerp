import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { bedBoard } from "@/server/services/ipd.service";
export const dynamic = "force-dynamic";
export const GET = handler(async (req) => {
  // INSURANCE_DESK: this portal now runs the whole admission - the bed board,
  // the admit form and the stay sheet - so a patient can be booked in on a
  // policy without walking the family to reception first.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK");
  return NextResponse.json(await bedBoard());
});
