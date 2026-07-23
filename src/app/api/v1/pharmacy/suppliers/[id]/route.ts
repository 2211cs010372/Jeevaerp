import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { supplierDetail } from "@/server/services/procurement.service";
export const dynamic = "force-dynamic";

/** One distributor's trading history - orders, receipts, credit still owed. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ supplier: await supplierDetail(id) });
});
