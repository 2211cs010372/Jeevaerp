import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { goodsReceiptDetail } from "@/server/services/procurement.service";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ receipt: await goodsReceiptDetail(id) });
});
