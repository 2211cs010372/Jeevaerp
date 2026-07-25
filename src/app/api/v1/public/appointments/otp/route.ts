import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requestBookingOtp } from "@/server/services/public-booking.service";
import { bookingOtpSchema } from "@/server/validators/public-booking";

export const dynamic = "force-dynamic";

/**
 * Step 1 of a public booking: send a one-time code to the number given.
 *
 * Unauthenticated by necessity - the person booking has no account yet. The
 * code is what stops this endpoint being used to fill the diary, and it is
 * rate-limited per phone number in the service.
 */
export const POST = handler(async (req) => {
  const input = await parseBody(req, bookingOtpSchema);
  const { sentTo, expiresInMs } = await requestBookingOtp(input);
  return NextResponse.json({
    message: `We've sent a 6-digit code to ${sentTo}.`,
    sentTo,
    expiresInMs,
  });
});
