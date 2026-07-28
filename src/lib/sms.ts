import { ApiError } from "@/lib/api";
// One definition of a phone number, shared with the rest of the ERP.
// Numbers are STORED as +91XXXXXXXXXX; each provider gets the shape it wants.
import { toBare10, toMsisdn } from "@/lib/phone";

/**
 * SMS transport for every OTP and confirmation the ERP sends.
 *
 * PRIMARY PROVIDER: Fast2SMS (https://www.fast2sms.com)
 *   Set FAST2SMS_API_KEY in .env - dashboard → Dev API → API Key.
 *   Nothing else is required for OTPs: the `otp` route uses Fast2SMS's own
 *   pre-approved template, so it works the moment the key is in place without
 *   waiting on a DLT registration.
 *
 * FALLBACK: 2Factor (https://2factor.in), the previous provider.
 *   Kept because it is what is configured today. Selection is automatic:
 *   Fast2SMS wins if its key is present, otherwise 2Factor, otherwise dev-log.
 *   That means pasting FAST2SMS_API_KEY into .env is the entire migration - no
 *   flag day, and no window where OTPs stop going out because a key was added
 *   in one place and removed from another. Set SMS_PROVIDER to force one.
 *
 * We generate and verify the code ourselves (lib/auth/otp.ts - hashed,
 * rate-limited, attempt-capped). A provider here is only a way to get digits
 * onto a handset; none of the security logic lives in this file.
 *
 * THE TRAP THIS FILE EXISTS TO ABSORB: the two providers disagree about the
 * phone number format. Fast2SMS wants a bare 10-digit Indian number and
 * silently fails on a country code; 2Factor requires the 91 prefix. One
 * `numbers` field, two incompatible meanings - so each transport formats its
 * own, and callers pass whatever they have.
 */

type Provider = "fast2sms" | "2factor";

const FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2";
const TWO_FACTOR_BASE = "https://2factor.in/API/V1";


/**
 * Which transport to use, and whether we have one at all.
 *
 * Reads process.env directly rather than through env(). Choosing a provider is
 * a question about two optional keys; routing it through the validated schema
 * would make it throw whenever anything ELSE in the environment is incomplete -
 * so a missing JWT secret would surface as "SMS is not configured". The keys are
 * still declared in env.ts so they are documented and typed.
 */
function pickProvider(): { provider: Provider; apiKey: string } | null {
  const fast = process.env.FAST2SMS_API_KEY?.trim();
  const twoFactor = process.env.TWO_FACTOR_API_KEY?.trim();
  const forced = process.env.SMS_PROVIDER?.trim().toLowerCase();

  if (forced === "fast2sms") return fast ? { provider: "fast2sms", apiKey: fast } : null;
  if (forced === "2factor") return twoFactor ? { provider: "2factor", apiKey: twoFactor } : null;

  if (fast) return { provider: "fast2sms", apiKey: fast };
  if (twoFactor) return { provider: "2factor", apiKey: twoFactor };
  return null;
}

/** Shape of a Fast2SMS reply. `return` is the success flag - it is a keyword, hence the quotes. */
interface Fast2SmsBody {
  return?: boolean;
  request_id?: string;
  message?: string[] | string;
  status_code?: number;
}

/**
 * Send one message through Fast2SMS.
 *
 * `route: "otp"` uses their built-in OTP template ("Your OTP: 123456") and needs
 * no DLT approval, which is why it is the default path for codes. Anything with
 * custom wording has to go through `route: "dlt"` with a registered template id -
 * Indian carriers reject free-text transactional SMS outright.
 */
async function sendViaFast2Sms(
  apiKey: string,
  params: Record<string, string | number>
): Promise<{ ok: true } | { ok: false; reason: string; detail?: unknown }> {
  let res: Response;
  try {
    res = await fetch(FAST2SMS_URL, {
      method: "POST",
      headers: { authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, reason: "network", detail: (err as Error).message };
  }

  const body: Fast2SmsBody | null = await res.json().catch(() => null);

  // Fast2SMS returns HTTP 200 with `return: false` for business errors - an
  // invalid key, no balance, a blocked number. Checking res.ok alone would
  // treat "you have no credits" as a successful send.
  if (!res.ok || body?.return !== true) {
    return { ok: false, reason: "provider", detail: { httpStatus: res.status, body } };
  }
  return { ok: true };
}

/**
 * Deliver a one-time code.
 *
 * Throws on failure: this sits on a login/booking path, and a code that never
 * arrives must surface as an error the user can act on, not as a silent dead end
 * where they wait for a message that is never coming.
 */
export async function sendOtpSms(phone: string, code: string): Promise<void> {
  const picked = pickProvider();

  if (!picked) {
    // process.env.NODE_ENV, not env(): this is the GRACEFUL branch, and routing
    // it through the validated schema made it throw whenever anything unrelated
    // in the environment was missing - turning "no SMS key in dev" into a hard
    // crash on the login path.
    if (process.env.NODE_ENV === "production") {
      // Fail loud - never silently swallow an auth path.
      throw new ApiError(503, "SMS provider is not configured");
    }
    // Development: the code goes to the server terminal only, never to a response.
    console.log(`[sms:dev] OTP for ${phone}: ${code}`);
    return;
  }

  if (picked.provider === "fast2sms") {
    const result = await sendViaFast2Sms(picked.apiKey, {
      route: "otp",
      variables_values: code,
      numbers: toBare10(phone),
    });
    if (!result.ok) {
      // The provider's own detail (low balance, bad key, DND) is logged server
      // side and deliberately not returned to the caller.
      console.error("[sms:fast2sms] OTP send failed", { phone: toBare10(phone), ...result });
      throw new ApiError(
        503,
        result.reason === "network"
          ? "Could not reach the SMS provider. Please try again."
          : "Failed to send the SMS. Please try again."
      );
    }
    return;
  }

  // ── 2Factor ──────────────────────────────────────────────────────────────
  const target = toMsisdn(phone);
  let res: Response;
  try {
    res = await fetch(`${TWO_FACTOR_BASE}/${picked.apiKey}/SMS/${target}/${code}`, {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error("[sms:2factor] network error", err);
    throw new ApiError(503, "Could not reach the SMS provider. Please try again.");
  }

  const body: { Status?: string; Details?: string } | null = await res.json().catch(() => null);
  if (!res.ok || body?.Status !== "Success") {
    console.error("[sms:2factor] send failed", { phone: target, httpStatus: res.status, body });
    throw new ApiError(503, "Failed to send the SMS. Please try again.");
  }
}

/**
 * Appointment confirmation SMS.
 *
 * TWO THINGS TO KNOW BEFORE PRODUCTION:
 *
 * 1. THIS NEVER THROWS. It is called after the appointment row is committed, and
 *    a failed text must not undo a booked slot - the patient is booked whether
 *    or not the message lands. Failures are logged for the desk to chase, and
 *    the OP number is always shown on screen as the real receipt.
 *
 * 2. INDIA REQUIRES DLT REGISTRATION for transactional SMS with custom wording.
 *    The template must be pre-approved and referenced by its id, and free-text
 *    sends are rejected by the carriers. Register the template in the Fast2SMS
 *    dashboard (DLT → Add Template), then set:
 *
 *      SMS_APPOINTMENT_TEMPLATE = the DLT template / message id
 *      SMS_SENDER_ID            = your approved 6-character header, e.g. JEEVAH
 *
 *    The template's variables are filled, IN ORDER, by the pipe-separated list
 *    below - so its body must read like:
 *      "Dear {#var#}, appointment {#var#} with {#var#} is confirmed for
 *       {#var#} at {#var#}. - Jeeva Hospital"
 *    Order matters and is not validated by the provider; a template whose
 *    variables are in a different order will send confidently wrong messages.
 *
 * Until the template is registered this logs instead of sending, so nothing
 * fails silently in a way that looks like it worked.
 */
export async function sendAppointmentSms(
  phone: string,
  vars: { name: string; opNumber: string; doctor: string; date: string; time: string }
): Promise<{ sent: boolean; reason?: string }> {
  const picked = pickProvider();
  const template = process.env.SMS_APPOINTMENT_TEMPLATE?.trim();
  const senderId = process.env.SMS_SENDER_ID?.trim() || "JEEVAH";

  const line =
    `Dear ${vars.name}, your appointment ${vars.opNumber} with ${vars.doctor} ` +
    `is confirmed for ${vars.date} at ${vars.time}. - Jeeva Hospital`;

  if (!picked || !template) {
    // Dev, or DLT template not registered yet. Say so in the log rather than
    // pretending it went out.
    console.log(`[sms:dev] appointment confirmation -> ${phone}: ${line}`);
    return { sent: false, reason: picked ? "no-template" : "not-configured" };
  }

  if (picked.provider === "fast2sms") {
    const result = await sendViaFast2Sms(picked.apiKey, {
      route: "dlt",
      sender_id: senderId,
      message: template,
      // Pipe-separated, in the template's own variable order.
      variables_values: [vars.name, vars.opNumber, vars.doctor, vars.date, vars.time].join("|"),
      numbers: toBare10(phone),
      flash: 0,
    });
    if (!result.ok) {
      console.error("[sms:fast2sms] confirmation failed", { phone: toBare10(phone), ...result });
      return { sent: false, reason: result.reason === "network" ? "network" : "provider-error" };
    }
    return { sent: true };
  }

  // ── 2Factor ──────────────────────────────────────────────────────────────
  const target = toMsisdn(phone);
  const url =
    `${TWO_FACTOR_BASE}/${picked.apiKey}/ADDON_SERVICES/SEND/TSMS` +
    `?From=${encodeURIComponent(senderId)}` +
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

/** Which provider is live right now - surfaced by the doctor script and admin health. */
export function smsStatus(): { configured: boolean; provider: Provider | null; templateReady: boolean } {
  const picked = pickProvider();
  return {
    configured: !!picked,
    provider: picked?.provider ?? null,
    templateReady: Boolean(process.env.SMS_APPOINTMENT_TEMPLATE?.trim()),
  };
}
