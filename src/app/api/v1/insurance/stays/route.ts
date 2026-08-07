import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { insuranceStays } from "@/server/services/insurance.service";

export const dynamic = "force-dynamic";

/** Every insurance stay, needing work or not - the desk's patient list. */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  return NextResponse.json(await insuranceStays());
});
