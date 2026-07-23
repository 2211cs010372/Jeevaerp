import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updatePurchaseReturnStatus } from "@/server/services/procurement.service";
import { returnStatusSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

/** Chase the claim: sent to the distributor, credited, or refused. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;
  const i = await parseBody(req, returnStatusSchema);
  await updatePurchaseReturnStatus(actor, {
    id, ...i,
    creditNoteNo: i.creditNoteNo || undefined,
    notes: i.notes || undefined,
  }, auditContext(req));
  return NextResponse.json({ ok: true });
});
