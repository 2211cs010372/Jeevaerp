import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { createPurchaseReturn, listPurchaseReturns } from "@/server/services/procurement.service";
import { purchaseReturnSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { searchParams } = new URL(req.url);
  return NextResponse.json({
    returns: await listPurchaseReturns({
      status: searchParams.get("status")?.trim() || undefined,
      supplierId: searchParams.get("supplierId")?.trim() || undefined,
    }),
  });
});

/** Send stock back up the chain and raise the credit claim that goes with it. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, purchaseReturnSchema);
  const r = await createPurchaseReturn(actor, { ...i, notes: i.notes || undefined }, auditContext(req));
  return NextResponse.json({ return: r }, { status: 201 });
});
