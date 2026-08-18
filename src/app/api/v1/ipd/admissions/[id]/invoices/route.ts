import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getInvoice } from "@/server/services/billing.service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * EVERY BILL RAISED AGAINST ONE STAY, in full, for printing as a run.
 *
 * A stay is billed by three counters on their own documents - the ward's IPD
 * invoice, the pharmacy's, the lab's - and a family or an insurer asking for
 * "the bills" means all of them. Printing them one at a time meant finding each
 * receipt number on a screen, opening it, printing, going back; on a week-long
 * stay with six pharmacy bills, that is where one gets missed.
 *
 * Ordered oldest-first so the run reads as the stay happened, and CANCELLED
 * bills are left out: a cancelled invoice is not part of what was charged, and
 * handing one to a family invites a question with no useful answer.
 */
export const GET = handler(async (req, ctx) => {
  // PHARMACIST included: the pharmacy raised several of these bills and prints
  // the run from its own counter, which is where a family at the medicine
  // window asks for them.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK", "PHARMACIST");
  const { id } = await ctx.params;

  const rows = await prisma.invoice.findMany({
    where: { admissionId: id, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const [invoices, hospital] = await Promise.all([
    // Sequential-safe: getInvoice is one indexed read per bill and a stay has a
    // handful, not hundreds.
    Promise.all(rows.map((r) => getInvoice(r.id))),
    prisma.hospitalConfig.findFirst({
      select: { legalName: true, addressLine: true, city: true, state: true, pincode: true, phone: true, gstin: true },
    }),
  ]);

  return NextResponse.json({ invoices, hospital });
});
