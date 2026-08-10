import { ApiError } from "@/lib/api";
// One definition of a phone number, shared with the rest of the ERP.
// Numbers are STORED as +91XXXXXXXXXX; each provider gets the shape it wants.
import { toBare10, toMsisdn, isIndianMobile } from "@/lib/phone";

/**
 * SMS transport for every OTP and confirmation the ERP sends.
 *
 * PRIMARY PROVIDER: Fast2SMS (https://www.fast2sms.com)
 *   Set FAST2SMS_API_KEY in .env - dashboard → Dev API → API Key.
 *
 * FALLBACK: 2Factor (https://2factor.in), the previous provider.
 *   Selection is automatic: Fast2SMS wins if its key is present, otherwise
 *   2Factor, otherwise dev-log. Pasting FAST2SMS_API_KEY in is the entire
 *   migration - no flag day, and no window where OTPs stop going out because a
 *   key was added in one place and removed from another. SMS_PROVIDER forces one.
 *
 * We generate and verify the code ourselves (lib/auth/otp.ts - hashed,
 * rate-limited, attempt-capped). A provider here is only a way to get digits
 * onto a handset; none of the security logic lives in this file.
 *
 * THE TRAP THIS FILE ABSORBS: the two providers disagree about the phone number
 * format. Fast2SMS wants a bare 10-digit Indian number and silently fails on a
 * country code; 2Factor requires the 91 prefix. One `numbers` field, two
 * incompatible meanings - so each transport formats its own from lib/phone.
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

/** Shape of a Fast2SMS reply. `return` is the success flag - a keyword, hence quoted. */
interface Fast2SmsBody {
  return?: boolean;
  request_id?: string;
  message?: string[] | string;
  status_code?: number;
}

/**
 * Codes that mean "this account cannot send that message, and will not be able
 * to until somebody changes a setting" - as opposed to a transient hiccup.
 *
 *   406 - sender id (header) not approved for this account
 *   412 - invalid authorisation key
 *   995 - template not approved on DLT
 *   996 - account not cleared for the OTP route (website verification pending)
 *
 * The distinction is not cosmetic. Telling a patient "please try again" when
 * retrying can never work leaves them tapping a button on a login screen
 * forever, and hides a problem only an administrator can fix.
 */
function isConfigError(statusCode?: number): boolean {
  return statusCode === 406 || statusCode === 412 || statusCode === 995 || statusCode === 996;
}

/**
 * Send one message through Fast2SMS.
 *
 * `route: "otp"` uses their built-in OTP template and needs no DLT approval -
 * but the ACCOUNT must have completed website verification. Anything with
 * custom wording goes through `route: "dlt"` with a registered template id;
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
    return {
      ok: false,
      reason: isConfigError(body?.status_code) ? "config" : "provider",
      detail: { httpStatus: res.status, body },
    };
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
    // TWO WAYS TO SEND A CODE, and which one an account may use is an account
    // setting, not a code decision:
    //
    //   route "otp" - Fast2SMS's own template, no DLT paperwork, but the
    //                 account must have completed website verification first.
    //   route "dlt" - your own DLT-approved template. Works on any account that
    //                 has one registered.
    //
    // SMS_OTP_TEMPLATE selects the second. Set it if verification is refused or
    // is taking too long; leave it unset for the simpler path.
    const otpTemplate = process.env.SMS_OTP_TEMPLATE?.trim();
    const result = otpTemplate
      ? await sendViaFast2Sms(picked.apiKey, {
          route: "dlt",
          sender_id: process.env.SMS_SENDER_ID?.trim() || "JEEVAH",
          message: otpTemplate,
          variables_values: code,
          numbers: toBare10(phone),
          flash: 0,
        })
      : await sendViaFast2Sms(picked.apiKey, {
          route: "otp",
          variables_values: code,
          numbers: toBare10(phone),
        });

    if (!result.ok) {
      // The provider's own detail (low balance, bad key, DND) is logged server
      // side and deliberately not returned to the caller.
      console.error("[sms:fast2sms] OTP send failed", {
        phone: toBare10(phone),
        route: otpTemplate ? "dlt" : "otp",
        ...result,
      });
      if (result.reason === "config") {
        // Say the true thing. Nobody should be asked to retry a setting.
        console.error(
          "[sms:fast2sms] THIS WILL NOT FIX ITSELF - the account cannot send on this route. " +
          "Complete website verification in the Fast2SMS dashboard (OTP Message menu), " +
          "or register a DLT template and set SMS_OTP_TEMPLATE."
        );
        throw new ApiError(503, "We can't send the code right now. Please call the hospital desk.");
      }
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
 *    Register the template in the Fast2SMS dashboard (DLT → Add Template), then:
 *
 *      SMS_APPOINTMENT_TEMPLATE = the Message ID Fast2SMS assigns it
 *      SMS_SENDER_ID            = your approved 6-character header, e.g. JEEVAH
 *
 *    The template's variables are filled, IN ORDER, by the pipe-separated list
 *    below - so its body must read like:
 *      "Dear {#var#}, appointment {#var#} with {#var#} is confirmed for
 *       {#var#} at {#var#}. - Jeeva Hospital"
 *    Order matters and is NOT validated by the provider; a template whose
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

/**
 * Send one DLT-templated transactional message. The generic form of
 * `sendAppointmentSms` above, for every other event the hospital notifies on.
 *
 * THREE RULES, all of them learned from the appointment path:
 *
 * 1. NEVER THROWS. Every caller sits after a committed transaction - a bill is
 *    raised, a patient is admitted, a report is signed. A provider outage must
 *    not roll any of that back, so failure is a logged `{ sent: false }` and
 *    never an exception. The printed receipt is the real receipt.
 *
 * 2. NEVER GUESSES A TEMPLATE. India rejects free-text transactional SMS, so a
 *    message with no registered DLT id is logged, not sent through some other
 *    route that happens to work today. `preview` is what WOULD have gone out,
 *    so the log is readable by whoever is registering the templates.
 *
 * 3. ORDER OF `vars` IS THE TEMPLATE'S ORDER, and no provider validates it. A
 *    template whose {#var#} slots are in a different order sends a confidently
 *    wrong message - "your bill 4500 for Rs INV-1029" - which is worse than not
 *    sending. Every caller in notify.service.ts documents its own order.
 */
export async function sendTemplatedSms(
  phone: string,
  spec: {
    /** Fast2SMS Message ID / 2Factor template name. Undefined = not registered yet. */
    templateId?: string;
    /** Values for the template's {#var#} slots, IN THE TEMPLATE'S OWN ORDER. */
    vars: string[];
    /** Human-readable rendering, for the log when the template is missing. */
    preview: string;
    /** Short event name, so a failure in the log says which message it was. */
    label: string;
  }
): Promise<{ sent: boolean; reason?: string }> {
  // The kill switch. Notifications are a per-message COST at a hospital that
  // bills a few hundred times a day, so there has to be a way to stop the
  // firehose that does not need a redeploy. Deliberately does not touch
  // sendOtpSms: OTP is authentication, not notification, and switching it off
  // would lock every patient out of the portal.
  if (process.env.SMS_NOTIFICATIONS?.trim().toLowerCase() === "off") {
    return { sent: false, reason: "disabled" };
  }

  const picked = pickProvider();
  const senderId = process.env.SMS_SENDER_ID?.trim() || "JEEVAH";
  const template = spec.templateId?.trim();

  if (!picked || !template) {
    console.log(
      `[sms:dev] ${spec.label} -> ${toBare10(phone)}: ${spec.preview}` +
      (picked ? "  (no DLT template registered)" : "  (no SMS provider configured)")
    );
    return { sent: false, reason: picked ? "no-template" : "not-configured" };
  }

  if (!isIndianMobile(toBare10(phone))) {
    // A landline or a junk number in the patient record. Worth a line in the log
    // - "the SMS never arrived" is otherwise investigated as a provider fault.
    console.warn(`[sms] ${spec.label}: not a mobile number, skipped`, { phone: toBare10(phone) });
    return { sent: false, reason: "not-mobile" };
  }

  if (picked.provider === "fast2sms") {
    const result = await sendViaFast2Sms(picked.apiKey, {
      route: "dlt",
      sender_id: senderId,
      message: template,
      variables_values: spec.vars.join("|"),
      numbers: toBare10(phone),
      flash: 0,
    });
    if (!result.ok) {
      console.error(`[sms:fast2sms] ${spec.label} failed`, { phone: toBare10(phone), ...result });
      return { sent: false, reason: result.reason === "network" ? "network" : "provider-error" };
    }
    return { sent: true };
  }

  // ── 2Factor ──────────────────────────────────────────────────────────────
  const target = toMsisdn(phone);
  const varQuery = spec.vars.map((v, i) => `&VAR${i + 1}=${encodeURIComponent(v)}`).join("");
  const url =
    `${TWO_FACTOR_BASE}/${picked.apiKey}/ADDON_SERVICES/SEND/TSMS` +
    `?From=${encodeURIComponent(senderId)}` +
    `&To=${target}&TemplateName=${encodeURIComponent(template)}${varQuery}`;

  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    const b: { Status?: string } | null = await r.json().catch(() => null);
    if (!r.ok || b?.Status !== "Success") {
      console.error(`[sms:2factor] ${spec.label} failed`, { phone: target, httpStatus: r.status, body: b });
      return { sent: false, reason: "provider-error" };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[sms:2factor] ${spec.label} network error`, err);
    return { sent: false, reason: "network" };
  }
}

/** Which provider is live right now - surfaced by the doctor script and admin health. */
export function smsStatus(): {
  configured: boolean;
  provider: Provider | null;
  /** Which Fast2SMS route OTPs will take. "dlt" needs SMS_OTP_TEMPLATE. */
  otpRoute: "otp" | "dlt" | null;
  templateReady: boolean;
} {
  const picked = pickProvider();
  return {
    configured: !!picked,
    provider: picked?.provider ?? null,
    otpRoute: picked?.provider === "fast2sms"
      ? (process.env.SMS_OTP_TEMPLATE?.trim() ? "dlt" : "otp")
      : null,
    templateReady: Boolean(process.env.SMS_APPOINTMENT_TEMPLATE?.trim()),
  };
}

// ---------------------------------------------------------------------------
// DIAGNOSTICS - "does SMS actually work from here, right now?"
// ---------------------------------------------------------------------------

/** Wallet balance, so an admin can tell "no credits" apart from "not allowed". */
export async function smsBalance(): Promise<
  { ok: true; wallet: string; smsCount: number } | { ok: false; error: string }
> {
  const picked = pickProvider();
  if (!picked || picked.provider !== "fast2sms") return { ok: false, error: "Fast2SMS is not the active provider" };
  try {
    const r = await fetch("https://www.fast2sms.com/dev/wallet", {
      headers: { authorization: picked.apiKey },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const b: { return?: boolean; wallet?: string; sms_count?: number; message?: string } | null =
      await r.json().catch(() => null);
    if (!r.ok || b?.return !== true) return { ok: false, error: String(b?.message ?? `HTTP ${r.status}`) };
    return { ok: true, wallet: String(b.wallet ?? "0"), smsCount: Number(b.sms_count ?? 0) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export type TestRoute = "otp" | "q" | "dlt";

/**
 * Send ONE real message, and report exactly what the provider said.
 *
 * This exists because "SMS is broken" is never actionable on its own. An account
 * can hold credits and a valid key and still be refused a particular route, and
 * the only way to tell those apart is to try and read the reply verbatim.
 *
 * Unlike sendOtpSms this NEVER throws and never hides the provider's words: an
 * administrator debugging delivery needs the real status code, not a message
 * written for a patient.
 *
 *   otp - Fast2SMS's own template. Needs website verification on the account.
 *   q   - Quick SMS. Free text, no DLT and no verification, but it will not
 *         reach a number registered on DND. Best first thing to try.
 *   dlt - Your registered template. Needs a Fast2SMS Message ID.
 */
export async function sendTestSms(
  phone: string,
  opts?: {
    route?: TestRoute;
    text?: string;
    /** Fast2SMS Message ID for the approved template. Overrides the env var. */
    templateId?: string;
    /** DLT-approved header. Must match EXACTLY - a wrong one is rejected. */
    senderId?: string;
    /** Pipe-separated values, in the template's own variable order. */
    variables?: string;
  }
): Promise<{ sent: boolean; route: TestRoute; to: string; providerSaid: unknown; sentParams?: unknown }> {
  const route: TestRoute = opts?.route ?? "q";
  const to = toBare10(phone);
  const picked = pickProvider();

  if (!picked || picked.provider !== "fast2sms") {
    return { sent: false, route, to, providerSaid: "Fast2SMS is not the active provider" };
  }
  if (!isIndianMobile(to)) {
    return { sent: false, route, to, providerSaid: "Not a valid 10-digit Indian mobile number" };
  }

  const text = opts?.text?.trim() || "Jeeva Hospital: test message. If you received this, SMS is working.";
  const sender = opts?.senderId?.trim() || process.env.SMS_SENDER_ID?.trim() || "JEEVAH";
  const templateId = opts?.templateId?.trim() || process.env.SMS_OTP_TEMPLATE?.trim() || "";

  if (route === "dlt" && !templateId) {
    return {
      sent: false, route, to,
      providerSaid: "No template id. Paste the Fast2SMS Message ID for your approved DLT template, or set SMS_OTP_TEMPLATE.",
    };
  }

  const params: Record<string, string | number> =
    route === "otp"
      ? { route: "otp", variables_values: "123456", numbers: to }
      : route === "dlt"
        ? {
            route: "dlt",
            sender_id: sender,
            // Fast2SMS wants the Message ID it assigns to your approved
            // template, which is not always the same string as the template id
            // shown on the operator's DLT portal. If one is rejected, the reply
            // says so and the other is worth trying.
            message: templateId,
            variables_values: opts?.variables?.trim() || "123456",
            numbers: to,
            flash: 0,
          }
        : { route: "q", message: text, language: "english", flash: 0, numbers: to };

  try {
    const r = await fetch(FAST2SMS_URL, {
      method: "POST",
      headers: { authorization: picked.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await r.json().catch(() => ({ httpStatus: r.status, body: "<unparseable>" }));
    const body = raw as Fast2SmsBody;
    // The request is echoed back (the key is never in it) because a rejected DLT
    // send is almost always a mismatch between what was sent and what was
    // approved - wrong header, wrong template id, wrong number of variables.
    return { sent: r.ok && body?.return === true, route, to, providerSaid: raw, sentParams: params };
  } catch (err) {
    return { sent: false, route, to, providerSaid: { error: (err as Error).message }, sentParams: params };
  }
}
