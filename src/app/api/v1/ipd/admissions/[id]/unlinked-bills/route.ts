import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listUnlinkedStayBills } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/**
 * OP pharmacy/lab bills raised during this stay that are not on it yet.
 * `?receipt=JMH…` looks up one named bill instead - see listUnlinkedStayBills.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const receipt = new URL(req.url).searchParams.get("receipt") ?? undefined;
  return NextResponse.json({ bills: await listUnlinkedStayBills(id, receipt) });
});
