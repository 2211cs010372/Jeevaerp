import { NextResponse } from "next/server";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { auditContext } from "@/server/services/audit.service";
import { refundInvoice } from "@/server/services/billing.service";
import { refundSchema } from "@/server/validators/reception";

export const dynamic = "force-dynamic";

/**
 * Give money back across the pharmacy counter - medicine returned, or a sale
 * billed wrong.
 *
 * The same write reception makes, with one extra lock: the bill has to be a
 * PHARMACY bill. Every guard about HOW MUCH may go back lives in the service
 * (assertRefundable); this route only decides WHOSE bills this counter is
 * allowed to touch, and the answer is its own.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { id } = await ctx.params;

  const inv = await prisma.invoice.findUnique({ where: { id }, select: { source: true } });
  if (!inv) throw new ApiError(404, "Bill not found");
  if (inv.source !== "PHARMACY") {
    throw new ApiError(403, "This is not a pharmacy bill - it is refunded at the desk that raised it.");
  }

  const input = await parseBody(req, refundSchema);
  const result = await refundInvoice(actor, { invoiceId: id, ...input }, auditContext(req));
  return NextResponse.json(result);
});
