import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listAdminBills } from "@/server/services/billing.service";
import { parseAdminBillsQuery } from "@/lib/admin-bills-query";

export const dynamic = "force-dynamic";

/**
 * Every bill across all counters, with how it was paid - ADMIN ONLY.
 *
 * All of them, a page at a time. The filters arrive as query params and run in
 * the database, so a bill from last year is as findable as today's and a load
 * reads one page, not the invoice table. See admin-bills-query for what each
 * filter means.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const p = req.nextUrl.searchParams;
  return NextResponse.json(await listAdminBills(parseAdminBillsQuery((k) => p.get(k))));
});
