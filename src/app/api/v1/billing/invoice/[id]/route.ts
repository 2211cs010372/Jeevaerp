import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getInvoice, updateInvoice } from "@/server/services/billing.service";
import { updateInvoiceSchema } from "@/server/validators/labs";
import { auditContext } from "@/server/services/audit.service";
export const dynamic = "force-dynamic";
/**
 * INSURANCE_DESK reads here, and reads ONLY here. A claim file is built out of
 * the individual receipts - the pharmacy slip, the lab bill, the consultation
 * from before the admission - so the room that assembles it has to be able to
 * open any one of them. It is deliberately absent from the PATCH below: the
 * insurance desk assembles claims, it does not edit what the counters billed.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "INSURANCE_DESK", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ invoice: await getInvoice(id) });
});

/**
 * Edit an UNPAID invoice's items/discount. Paid invoices must be cancelled instead.
 *
 * The role list is the OUTER door. Whether reception and the insurance desk may
 * actually walk through it is HospitalConfig.billEditingEnabled, checked inside
 * updateInvoice - a permission belongs next to the write, not next to the URL.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "PHARMACIST", "INSURANCE_DESK", "ADMIN");
  const { id } = await ctx.params;
  const body = await parseBody(req, updateInvoiceSchema.omit({ invoiceId: true }));
  const invoice = await updateInvoice(
    actor,
    { invoiceId: id, ...body, trimPaymentsToTotal: body.trimPaymentsToTotal ?? true },
    auditContext(req)
  );
  return NextResponse.json({ invoice });
});
