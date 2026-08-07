import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { detailedBillData } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/**
 * The claim bill, assembled. Reception is on the guard too: the front desk is
 * asked for a copy of this sheet at discharge as often as the insurance room is,
 * and sending them to another portal for it is how a second, hand-typed version
 * of the same bill starts existing.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const { id } = await ctx.params;
  return NextResponse.json(await detailedBillData(id));
});
