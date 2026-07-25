import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { auditContext } from "@/server/services/audit.service";
import { confirmBooking } from "@/server/services/public-booking.service";
import { confirmBookingSchema } from "@/server/validators/public-booking";

export const dynamic = "force-dynamic";

/**
 * Step 2: verify the code and actually book the slot.
 *
 * On success the appointment exists in the ERP exactly as if reception had
 * made it - same OP number series, same slot, same diary - so it appears on
 * the desk's Today list without anyone re-keying it.
 */
export const POST = handler(async (req) => {
  const input = await parseBody(req, confirmBookingSchema);
  const booking = await confirmBooking(input, auditContext(req));
  return NextResponse.json({ booking }, { status: 201 });
});
