import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { settlementBoard } from "@/server/services/insurance.service";

export const dynamic = "force-dynamic";

/**
 * Where every decided claim leaves the money - and which ones are waiting on
 * somebody to move it onto a patient. See settlementBoard.
 *
 * RECEPTIONIST is on the guard deliberately. The whole point of this list is
 * that the front desk stops having to go looking: a family arrives with a TPA
 * refusal letter and the person at the counter can see the same board the
 * insurance room does, rather than searching a billing screen for a bill that
 * is - correctly - not on it yet.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  return NextResponse.json(await settlementBoard());
});
