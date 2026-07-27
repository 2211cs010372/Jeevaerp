import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { auditContext } from "@/server/services/audit.service";
import { submitCallbackRequest } from "@/server/services/appointment-requests.service";
import { callbackRequestSchema } from "@/server/validators/public-booking";

export const dynamic = "force-dynamic";

/**
 * Step 2: verify the code and queue the request for reception.
 *
 * Creates NO patient record and NO appointment - only an intent for the desk
 * to act on. See appointment-requests.service for why that separation matters.
 */
export const POST = handler(async (req) => {
  const input = await parseBody(req, callbackRequestSchema);
  const request = await submitCallbackRequest(input, auditContext(req));
  return NextResponse.json({ request }, { status: 201 });
});
