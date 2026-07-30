import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listErrors, unresolvedErrorCount } from "@/server/services/errors.service";

export const dynamic = "force-dynamic";

/**
 * The crash list. ADMIN only: a stack trace names internal files and, even after
 * scrubbing, tells a reader how the system is put together.
 *
 * `?resolved=1` includes bugs already marked handled, so the fix can be checked
 * for recurrence rather than disappearing from view.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const includeResolved = req.nextUrl.searchParams.get("resolved") === "1";
  return NextResponse.json({
    errors: await listErrors({ includeResolved }),
    unresolved: await unresolvedErrorCount(),
  });
});
