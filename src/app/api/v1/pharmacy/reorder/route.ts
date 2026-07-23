import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { createPurchaseOrdersFromReorder, reorderSuggestions } from "@/server/services/procurement.service";
import { reorderDraftSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

/** What to buy, grouped by who we buy it from, netted off what's already coming. */
export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  return NextResponse.json(await reorderSuggestions());
});

/** Turn the selection into one purchase order per distributor. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, reorderDraftSchema);
  return NextResponse.json(await createPurchaseOrdersFromReorder(actor, i, auditContext(req)), { status: 201 });
});
