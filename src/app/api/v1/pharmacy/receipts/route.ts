import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listGoodsReceipts, receiveGoods } from "@/server/services/procurement.service";
import { receiveGoodsSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") ?? "");
  return NextResponse.json({
    receipts: await listGoodsReceipts({
      supplierId: searchParams.get("supplierId")?.trim() || undefined,
      query: searchParams.get("q")?.trim() || undefined,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
    }),
  });
});

/**
 * Post a goods receipt. This is the ONLY route that puts supplier stock on the
 * shelf - batches, ledger, PO fulfilment and supplier lineage all move together
 * or not at all.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, receiveGoodsSchema);
  const grn = await receiveGoods(actor, {
    ...i,
    invoiceNo: i.invoiceNo || undefined,
    notes: i.notes || undefined,
  }, auditContext(req));
  return NextResponse.json({ receipt: grn }, { status: 201 });
});
