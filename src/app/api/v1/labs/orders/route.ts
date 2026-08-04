import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listLabOrders } from "@/server/services/labs.service";

export const dynamic = "force-dynamic";

/**
 * The bench queue, one row per ORDER rather than per test.
 *
 * Separate from /labs/tests, which stays flat: the dashboard counts tests, and
 * billing settles tests, but the technician works orders.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "LAB_TECH", "ADMIN");
  const s = new URL(req.url).searchParams.get("status");
  const status = s === "PENDING" || s === "COMPLETED" ? s : undefined;
  return NextResponse.json({ orders: await listLabOrders(status) });
});
