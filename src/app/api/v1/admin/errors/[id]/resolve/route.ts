import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { resolveError } from "@/server/services/errors.service";
import { logAudit, auditContext } from "@/server/services/audit.service";

export const dynamic = "force-dynamic";

/**
 * Mark a crash handled.
 *
 * Audited, because "who decided this bug was fine" is a question worth being able
 * to answer later - and because a resolve is the one write on this table a person
 * performs. If the same crash happens again, captureError clears the resolution,
 * so this is a claim the data is free to contradict.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  await resolveError(id, actor.id);
  await logAudit(actor, {
    action: "ERROR_RESOLVED",
    targetTable: "ErrorLog",
    targetId: id,
    ...auditContext(req),
  });
  return NextResponse.json({ ok: true });
});
