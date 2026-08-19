import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { correctGoodsReceipt, goodsReceiptDetail } from "@/server/services/procurement.service";
import { correctGoodsReceiptSchema } from "@/server/validators/procurement";
import { auditContext } from "@/server/services/audit.service";
import { parseBody } from "@/lib/api";
export const dynamic = "force-dynamic";

export const GET = handler(async (req, ctx) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ receipt: await goodsReceiptDetail(id) });
});

/**
 * Correct a receipt after cross-checking it against the paper invoice.
 *
 * PHARMACIST, not just ADMIN: the person who booked the delivery in is the one
 * holding the bill an hour later, and routing a typo through a manager is how
 * the correction never gets made and the shelf stays wrong.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, correctGoodsReceiptSchema);
  const result = await correctGoodsReceipt(actor, id, input, auditContext(req));
  return NextResponse.json({ ...result, receipt: await goodsReceiptDetail(id) });
});
