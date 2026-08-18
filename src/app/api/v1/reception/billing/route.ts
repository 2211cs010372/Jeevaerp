import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listInvoices } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/** Every bill the desk might need to settle, void or reprint. */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const source = req.nextUrl.searchParams.get("source") ?? undefined;
  // `date` is yyyy-mm-dd and narrows to that one calendar day. Without it the
  // desk gets its usual working queue - the most recent hundred bills.
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const invoices = await listInvoices(source as never, date ? 500 : 100, date);
  return NextResponse.json({ invoices });
});
