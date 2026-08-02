import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { setPatientArchived } from "@/server/services/admin-patients.service";
import { archivePatientSchema } from "@/server/validators/admin";
import { auditContext } from "@/server/services/audit.service";

export const dynamic = "force-dynamic";

/**
 * Archive or restore a patient.
 *
 * POST and not DELETE, because nothing is deleted: `deletedAt` is set, every
 * read in the codebase already treats that as gone, and the same call with
 * `archived: false` puts the record back. The verb matches what actually
 * happens, so nobody reads the route list and assumes rows are being destroyed.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { displayId } = await ctx.params;
  const { archived } = await parseBody(req, archivePatientSchema);
  const result = await setPatientArchived(actor, displayId.toUpperCase(), archived, auditContext(req));
  return NextResponse.json(result);
});
