import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";

/**
 * SMS provider: 2Factor.in (https://2factor.in).
 *
 * Setup:
 *   1. Sign up at https://2factor.in/v3/signup - free trial credits land
 *      on your account immediately, no card required.
 *   2. Copy the API key from the dashboard and set TWO_FACTOR_API_KEY
 *      in .env.
 *   3. That's it. When the trial balance runs out, recharge the same
 *      account (dashboard → Recharge) - same API key, same endpoint,
 *      zero code changes to go from trial to paid.
 *
 * We generate and verify the OTP ourselves (see lib/auth/otp.ts - hashed,
 * rate-limited, attempt-capped). 2Factor is used purely as an SMS
 * transport via its "send my own code" endpoint, so none of that logic
 * changes here; this function only has to get the code onto the phone.
 *
 * Docs: https://2factor.in/API/DOCS/SMS_OTP.html - worth a quick check
 * against your dashboard if a call ever comes back malformed, since
 * providers do tweak response shapes over time.
 */

const TWO_FACTOR_BASE = "https://2factor.in/API/V1";

/** "9876543210" -> "919876543210". 2Factor expects the country code, no "+" or spaces. */
function toIndianMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits : `91${digits}`;
}

export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const apiKey = env().TWO_FACTOR_API_KEY;

  if (!apiKey) {
    if (env().NODE_ENV === "production") {
      // Fail loud, never silently swallow a login path.
      throw new ApiError(503, "SMS provider is not configured");
    }
    // Development: the code appears in the server terminal only - never in an API response.
    console.log(`[sms:dev] OTP for ${phone}: ${code}`);
    return;
  }

  const target = toIndianMsisdn(phone);
  const url = `${TWO_FACTOR_BASE}/${apiKey}/SMS/${target}/${code}`;

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.error("[sms:2factor] network error", err);
    throw new ApiError(503, "Could not reach the SMS provider. Please try again.");
  }

  const body: { Status?: string; Details?: string } | null = await res.json().catch(() => null);

  if (!res.ok || body?.Status !== "Success") {
    // Log the provider's own error detail server-side (e.g. low balance,
    // invalid key, DND-blocked number) without leaking it to the client.
    console.error("[sms:2factor] send failed", { phone: target, httpStatus: res.status, body });
    throw new ApiError(503, "Failed to send the SMS. Please try again.");
  }
}