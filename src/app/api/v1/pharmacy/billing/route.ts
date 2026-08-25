import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listInvoices } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/**
 * THE COUNTER'S OWN BILL BOOK.
 *
 * The same list reception works from, narrowed to this counter. The source is
 * pinned HERE rather than taken from the query string: a pharmacist asking for
 * "bills" must never be one edited URL away from reception's consultation
 * receipts, which they have no business voiding or refunding.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  // `date` is yyyy-mm-dd and narrows to that one calendar day. Without it the
  // counter gets its working queue - the most recent hundred bills. The day
  // filter has to be a QUERY, not a pass over an already-truncated list, or any
  // day further back than that hundred comes back empty.
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  const invoices = await listInvoices("PHARMACY", date ? 500 : 100, date);
  return NextResponse.json({ invoices });
});
