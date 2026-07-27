import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { updateCallbackRequest } from "@/server/services/appointment-requests.service";
import { updateCallbackRequestSchema } from "@/server/validators/public-booking";

export const dynamic = "force-dynamic";

/** Move a request along: rang them, booked them, or closed it. */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, updateCallbackRequestSchema);
  const request = await updateCallbackRequest(
    actor,
    { id, status: input.status, note: input.note || undefined, appointmentId: input.appointmentId || undefined },
    auditContext(req)
  );
  return NextResponse.json({ request });
});
