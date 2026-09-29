import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { linkBillsToStay } from "@/server/services/ipd.service";
import { linkBillsSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** Put forgotten OP pharmacy/lab bills onto this stay - see linkBillsToStay. */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const { invoiceIds } = await parseBody(req, linkBillsSchema);
  return NextResponse.json(await linkBillsToStay(actor, id, invoiceIds, auditContext(req)));
});
