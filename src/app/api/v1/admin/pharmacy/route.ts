import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { pharmacyOverview } from "@/server/services/admin-pharmacy.service";
export const dynamic = "force-dynamic";

/** Everything the pharmacy knows about itself, in one call, for the owner. */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  return NextResponse.json(await pharmacyOverview());
});
