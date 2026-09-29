import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getPatientByDisplayId } from "@/server/services/reception.service";
import { listPatientInvoices } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/** Every bill on this patient's record, newest first - see listPatientInvoices. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { displayId } = await ctx.params;
  const patient = await getPatientByDisplayId(displayId.toUpperCase());
  return NextResponse.json({ invoices: await listPatientInvoices(patient.id) });
});
