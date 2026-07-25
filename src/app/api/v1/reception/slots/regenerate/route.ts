import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { regenerateFutureSlots, SLOT_HORIZON_DAYS } from "@/server/services/slots.service";

export const dynamic = "force-dynamic";

/**
 * Rebuild the future booking grid at a 10-minute cadence. Reception/admin.
 * The horizon is the shared constant - this route used to pin its own 14 days,
 * so pressing "Regenerate" silently SHRANK a grid built for longer.
 */
export const POST = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  return NextResponse.json(await regenerateFutureSlots(10, SLOT_HORIZON_DAYS));
});
