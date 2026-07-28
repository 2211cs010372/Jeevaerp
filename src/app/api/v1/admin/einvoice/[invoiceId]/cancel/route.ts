import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { cancelEInvoice } from "@/server/services/einvoice.service";
import { cancelEInvoiceSchema } from "@/server/validators/einvoice";

export const dynamic = "force-dynamic";

/**
 * Cancel an IRN. Its own route rather than another `action` on the parent
 * because this is the destructive one, and a route that can only cancel is
 * easier to reason about when auditing who could do what.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { invoiceId } = await ctx.params;
  const input = await parseBody(req, cancelEInvoiceSchema);
  return NextResponse.json({ eInvoice: await cancelEInvoice(actor, invoiceId, input, auditContext(req)) });
});
