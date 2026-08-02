import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listAdminPatients } from "@/server/services/admin-patients.service";

export const dynamic = "force-dynamic";

/**
 * The patient register.
 *
 * Filters arrive as query params for the same reason the audit log does: this is
 * a read, and an admin who has found the row they want should be able to paste
 * the URL to somebody else and have them land on it.
 *
 * ADMIN only. The rows carry billed totals per patient, which is not a number
 * the front desk gets to browse.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const p = req.nextUrl.searchParams;
  const sort = p.get("sort");

  const result = await listAdminPatients({
    q: p.get("q") ?? undefined,
    includeArchived: p.get("archived") === "1",
    sort: sort === "name" || sort === "revenue" ? sort : "recent",
    page: p.get("page") ? Number(p.get("page")) : undefined,
    pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : undefined,
  });

  return NextResponse.json(result);
});
