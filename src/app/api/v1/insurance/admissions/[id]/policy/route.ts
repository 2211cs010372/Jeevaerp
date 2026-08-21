import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { setStayPolicy } from "@/server/services/insurance.service";
import { setStayPolicySchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/**
 * Record the policy number that was not taken at admission.
 *
 * RECEPTION is on the guard alongside the desk, because the card is as likely to
 * be handed over at the front counter as at this one - the attendant produces it
 * on the way back from the ward, and a rule that says only the insurance room
 * may type it in is a rule that gets solved with a sticky note.
 *
 * The stay and its unanswered claims both, in one transaction - see
 * setStayPolicy for which claims it will and will not touch.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const { id } = await ctx.params;
  const input = await parseBody(req, setStayPolicySchema);
  return NextResponse.json(await setStayPolicy(actor, id, input, auditContext(req)));
});
