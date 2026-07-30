import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listAuditLog, auditFilterOptions } from "@/server/services/admin.service";

export const dynamic = "force-dynamic";

/**
 * The audit trail, filterable.
 *
 * Filters arrive as query params rather than a POST body because this is a read
 * and the result should be linkable: an admin investigating a missing payment can
 * paste the URL into a message and the other person sees the same rows.
 *
 * ADMIN only, as before. The response now carries meta and targetId, which is
 * what makes a row usable as evidence, and is why the role gate matters.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const p = req.nextUrl.searchParams;

  const result = await listAuditLog({
    actorUserId: p.get("actor") ?? undefined,
    action: p.get("action") ?? undefined,
    targetTable: p.get("table") ?? undefined,
    targetId: p.get("target") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  });

  // Only on the first page: the dropdown contents do not change between pages and
  // two extra DISTINCT scans per "load more" is waste.
  const options = result.offset === 0 ? await auditFilterOptions() : undefined;

  return NextResponse.json({ ...result, ...(options ? { options } : {}) });
});
