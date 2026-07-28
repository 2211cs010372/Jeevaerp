import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { pharmacyDues } from "@/server/services/pharmacy.service";
export const dynamic = "force-dynamic";

// Reception reads this too: the front desk is where a discharge gets held up,
// so it needs to see the same unpaid pharmacy bills the counter is chasing.
export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "RECEPTIONIST", "ADMIN");
  return NextResponse.json(await pharmacyDues());
});
