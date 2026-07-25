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

/**
 * Appointment confirmation SMS.
 *
 * TWO THINGS TO KNOW BEFORE PRODUCTION:
 *
 * 1. This NEVER throws. It is called after the appointment row is committed,
 *    and a failed text must not undo a booked slot - the patient is booked
 *    whether or not the message lands. Failures are logged for the desk to
 *    chase, and the OP number is always shown on screen as the real receipt.
 *
 * 2. India requires DLT registration for transactional SMS: the template must
 *    be pre-approved and referenced by name, and free-text sends are rejected
 *    by the carriers. Register the template in the 2Factor dashboard, put its
 *    name in SMS_APPOINTMENT_TEMPLATE, and the variables below fill it. Until
 *    that is set, this logs instead of sending, so nothing silently fails in
 *    a way that looks like it worked.
 */
export async function sendAppointmentSms(
  phone: string,
  vars: { name: string; opNumber: string; doctor: string; date: string; time: string }
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = env().TWO_FACTOR_API_KEY;
  const template = process.env.SMS_APPOINTMENT_TEMPLATE;

  const line = `Dear ${vars.name}, your appointment ${vars.opNumber} with ${vars.doctor} is confirmed for ${vars.date} at ${vars.time}. - Jeeva Hospital`;

  if (!apiKey || !template) {
    // Dev, or DLT template not registered yet. Say so in the log rather than
    // pretending it went out.
    console.log(`[sms:dev] appointment confirmation -> ${phone}: ${line}`);
    return { sent: false, reason: apiKey ? "no-template" : "not-configured" };
  }

  const target = toIndianMsisdn(phone);
  const url =
    `${TWO_FACTOR_BASE}/${apiKey}/ADDON_SERVICES/SEND/TSMS` +
    `?From=${encodeURIComponent(process.env.SMS_SENDER_ID ?? "JEEVAH")}` +
    `&To=${target}&TemplateName=${encodeURIComponent(template)}` +
    `&VAR1=${encodeURIComponent(vars.name)}` +
    `&VAR2=${encodeURIComponent(vars.opNumber)}` +
    `&VAR3=${encodeURIComponent(vars.doctor)}` +
    `&VAR4=${encodeURIComponent(vars.date)}` +
    `&VAR5=${encodeURIComponent(vars.time)}`;

  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    const b: { Status?: string } | null = await r.json().catch(() => null);
    if (!r.ok || b?.Status !== "Success") {
      console.error("[sms:2factor] confirmation failed", { phone: target, httpStatus: r.status, body: b });
      return { sent: false, reason: "provider-error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[sms:2factor] confirmation network error", err);
    return { sent: false, reason: "network" };
  }
}