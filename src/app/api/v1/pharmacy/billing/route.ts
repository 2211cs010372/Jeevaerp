import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { billsLimit, listInvoices } from "@/server/services/billing.service";

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
  // `limit` is what the "All bills" tab asks for - see the note on the same
  // parameter in the reception route. Clamped, so an edited URL cannot ask this
  // counter to read the whole invoice table into memory.
  const limit = billsLimit(req.nextUrl.searchParams.get("limit"));
  const invoices = await listInvoices("PHARMACY", date ? undefined : limit, date);
  return NextResponse.json({ invoices });
});
