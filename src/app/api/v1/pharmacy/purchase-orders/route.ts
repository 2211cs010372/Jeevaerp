import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/services/procurement.service";
import { createPoSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { searchParams } = new URL(req.url);
  return NextResponse.json({
    orders: await listPurchaseOrders({
      status: searchParams.get("status")?.trim() || undefined,
      supplierId: searchParams.get("supplierId")?.trim() || undefined,
      query: searchParams.get("q")?.trim() || undefined,
    }),
  });
});

export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, createPoSchema);
  const po = await createPurchaseOrder(actor, { ...i, notes: i.notes || undefined }, auditContext(req));
  return NextResponse.json({ order: po }, { status: 201 });
});
