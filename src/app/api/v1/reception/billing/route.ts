import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { billsLimit, BILLS_PAGE_MAX, listInvoices } from "@/server/services/billing.service";

export const dynamic = "force-dynamic";

/**
 * Every bill the desk might need to settle, void or reprint - EXCEPT the
 * pharmacy's.
 *
 * A medicine receipt is raised, settled, voided and reprinted at the medicine
 * window, which has its own bills screen and its own till. They were on this
 * list as well, which padded the front desk's working queue with rows nobody
 * there acts on - and let a receptionist void a dispense from a screen with no
 * sight of the shelf, which now moves stock as well as money.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  // The one source this desk does not carry is not one it can ask for either:
  // `?source=PHARMACY` would otherwise be handed straight to the query and walk
  // past the exclusion below.
  const asked = req.nextUrl.searchParams.get("source") ?? undefined;
  const source = asked === "PHARMACY" ? undefined : asked;
  // `date` is yyyy-mm-dd and narrows to that one calendar day. Without it the
  // desk gets its usual working queue - the most recent hundred bills.
  const date = req.nextUrl.searchParams.get("date") ?? undefined;
  // ── AND `limit`, FOR THE TAB THAT SAYS "ALL BILLS" ──
  //
  // A hundred is the right size for the working queue, which is what this
  // screen is nearly all of the time. It is the wrong size for the one tab that
  // promises every bill: in this hospital a hundred bills is about a week, so
  // "All bills" quietly meant "this week's", and a fortnight-old receipt simply
  // was not on the screen the desk was told held all of them.
  //
  // Clamped, and clamped to the same 500 a dated query already returns - that
  // page size is proven on this screen. Anything older than the window is
  // reached through the day filter, which is a query and has the whole table
  // behind it.
  const limit = billsLimit(req.nextUrl.searchParams.get("limit"));
  const invoices = await listInvoices(source as never, date ? BILLS_PAGE_MAX : limit, date, "PHARMACY");
  return NextResponse.json({ invoices });
});
