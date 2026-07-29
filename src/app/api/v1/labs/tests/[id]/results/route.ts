import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { labResultSheet, saveLabResults } from "@/server/services/labs.service";
import { saveLabResultsSchema } from "@/server/validators/labs";

export const dynamic = "force-dynamic";

/**
 * The result sheet for one test - saved values, or blank rows from the analyte
 * template. Doctors read it too, so they can see the numbers without the file.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN", "DOCTOR");
  const { id } = await ctx.params;
  return NextResponse.json(await labResultSheet(id));
});

/** Enter or correct the measured values (and the bench's impression). Lab only. */
export const PUT = handler(async (req, ctx) => {
  const actor = await requireRole(req, "LAB_TECH", "ADMIN");
  const { id } = await ctx.params;
  const body = await parseBody(req, saveLabResultsSchema);
  const result = await saveLabResults(actor, { labTestId: id, ...body }, auditContext(req));
  return NextResponse.json(result);
});
