import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { pendingWork } from "@/server/services/insurance.service";

export const dynamic = "force-dynamic";

/**
 * Stays flagged INSURANCE at admission with no claim raised against them yet.
 *
 * Also backs the sidebar badge, which reads `count` off this same response - the
 * badge and the list can never disagree because there is only one query.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  return NextResponse.json(await pendingWork());
});
