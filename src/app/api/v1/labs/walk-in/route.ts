import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { walkInOrder } from "@/server/services/labs.service";
import { walkInSchema } from "@/server/validators/labs";

export const dynamic = "force-dynamic";

/**
 * The lab counter in one call: register the walk-in if they are new, order the
 * tests, and bill them.
 *
 * LAB_TECH can register a patient through here even though the reception
 * registration endpoint doesn't allow it. That is the point - a lab that cannot
 * create a record has to send a walk-in to another desk to be typed in before
 * it can take a sample, and the schema needs a Patient row before it can hold a
 * test or an invoice. The form behind this asks for a name and a mobile only.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN");
  const input = await parseBody(req, walkInSchema);
  const result = await walkInOrder(actor, input, auditContext(req));
  return NextResponse.json(result, { status: 201 });
});
