import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addAdvance } from "@/server/services/ipd.service";
import { advanceSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** Take the deposit at admission. Adjusted against the discharge bill. */
export const POST = handler(async (req, ctx) => {
  // INSURANCE_DESK: the claims desk works the whole stay from its own portal,
  // so it needs the same writes reception has. Granted field by field - see
  // the note on the Role enum for why this role is widened deliberately.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, advanceSchema);
  const result = await addAdvance(actor, { admissionId: id, ...input }, auditContext(req));
  return NextResponse.json(result);
});
