import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateStaff, deleteStaff } from "@/server/services/admin.service";
import { updateStaffSchema } from "@/server/validators/admin";

export const dynamic = "force-dynamic";

/** Edit a staff account, including the consulting profile if it is a doctor. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, updateStaffSchema);
  const staff = await updateStaff(actor, id, input, auditContext(req));
  return NextResponse.json({ staff });
});

/**
 * Remove a staff account.
 *
 * Deletes it outright when nothing points at it. When it has signed invoices,
 * run lab tests or seen patients, the account is disabled instead and the
 * response says which - the caller must show that message rather than reporting
 * a plain "deleted", because the row is still there.
 */
export const DELETE = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { id } = await ctx.params;
  const result = await deleteStaff(actor, id, auditContext(req));
  return NextResponse.json(result);
});
