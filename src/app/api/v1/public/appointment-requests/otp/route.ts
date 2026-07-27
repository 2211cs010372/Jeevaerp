import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requestCallbackOtp } from "@/server/services/appointment-requests.service";
import { callbackOtpSchema } from "@/server/validators/public-booking";

export const dynamic = "force-dynamic";

/**
 * Step 1 of a callback request: send a one-time code to the number given.
 *
 * Unauthenticated by necessity - nobody raising an enquiry has an account. The
 * code is what stops this endpoint being used to flood the reception queue,
 * and it is rate-limited per phone number in the service, sharing the same
 * window as every other OTP path so a caller cannot hop between forms.
 */
export const POST = handler(async (req) => {
  const input = await parseBody(req, callbackOtpSchema);
  const { sentTo, expiresInMs } = await requestCallbackOtp(input);
  return NextResponse.json({
    message: `We've sent a 6-digit code to ${sentTo}.`,
    sentTo,
    expiresInMs,
  });
});
