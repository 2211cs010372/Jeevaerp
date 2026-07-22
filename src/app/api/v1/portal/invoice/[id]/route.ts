import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/api";
import { requireAuth } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { getInvoice } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/**
 * The signed-in patient's own bill. Same Bill-of-Supply sheet the desk prints
 * (getInvoice), gated on ownership so a patient can only open their own invoice.
 */
export const GET = handler(async (req, ctx) => {
  const caller = await requireAuth(req);
  if (caller.role !== "PATIENT") throw new ApiError(403, "Patients only");
  const { id } = await ctx.params;
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { patientId: true } });
  if (!inv || inv.patientId !== caller.id) throw new ApiError(404, "Invoice not found");
  return NextResponse.json({ invoice: await getInvoice(id) });
});
