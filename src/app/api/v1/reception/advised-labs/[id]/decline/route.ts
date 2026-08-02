import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { declineAdvisedLab } from "@/server/services/prescriptions.service";
import { declineAdvisedLabSchema } from "@/server/validators/reception";

export const dynamic = "force-dynamic";

/**
 * Take an advised test off the outstanding list without ordering it.
 *
 * The reason is required by the validator AND the service. An outstanding list
 * that can be emptied with one silent click is worth nothing - clearing it
 * becomes the quickest way to make the warning go away, and the record of why a
 * doctor's instruction was not followed disappears with it.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, declineAdvisedLabSchema);
  const row = await declineAdvisedLab(actor, { id, reason }, auditContext(req));
  return NextResponse.json(row);
});
