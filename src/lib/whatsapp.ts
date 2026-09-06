// One definition of a phone number, shared with the rest of the ERP.
// Numbers are STORED as +91XXXXXXXXXX; each provider gets the shape it wants.
import { toBare10, toMsisdn, isIndianMobile } from "@/lib/phone";

/**
 * WHATSAPP TRANSPORT.
 *
 * Deliberately built the same way as lib/sms.ts, because WhatsApp has the same
 * shape of problem as Indian SMS: you cannot send business-initiated free text.
 * Meta requires a PRE-APPROVED TEMPLATE, exactly as the carriers require a DLT
 * registration - so this file knows how to reach a handset, and nothing here
 * invents wording.
 *
 * ─── THE 24-HOUR WINDOW, WHICH IS WHY THE REPORT USES A TEMPLATE ───────────
 * Free text is allowed ONLY within 24 hours of the recipient last messaging the
 * business number. A report that goes out at 9:30 PM will usually fall outside
 * that window, so the daily report sends a TEMPLATE and free text exists only
 * as an explicit opt-in (WHATSAPP_ALLOW_FREE_TEXT=on) for admins who have just
 * messaged the number - useful while testing, wrong as the default.
 *
 * ─── PROVIDERS ─────────────────────────────────────────────────────────────
 *   meta   - WhatsApp Cloud API, direct from Meta. WHATSAPP_TOKEN +
 *            WHATSAPP_PHONE_NUMBER_ID. Also the right choice for an Indian BSP
 *            (AiSensy, Interakt, Wati) that proxies Meta's own request shape -
 *            point WHATSAPP_API_BASE at theirs.
 *   twilio - TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM.
 *            Templates are Content SIDs there, not names.
 *
 * With neither configured, every send LOGS the message it would have sent and
 * returns { sent: false }. That is the honest state until credentials exist,
 * and it means switching WhatsApp on later is pasting env vars - no redeploy of
 * different code, and no window where the report silently stops going out.
 *
 * ─── NOTHING HERE THROWS ───────────────────────────────────────────────────
 * Same rule as notify.service.ts. Every caller runs after the day's work is
 * committed; a provider outage is a logged failure, never an exception.
 */

export type WhatsAppProvider = "meta" | "twilio";

const META_DEFAULT_BASE = "https://graph.facebook.com/v21.0";
const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export type WhatsAppOutcome = { sent: boolean; reason?: string; id?: string; detail?: unknown };

type Picked =
  | { provider: "meta"; token: string; phoneNumberId: string; base: string }
  | { provider: "twilio"; sid: string; authToken: string; from: string };

/**
 * Which transport to use, and whether we have one at all.
 *
 * process.env directly, not env(): choosing a provider is a question about a
 * handful of optional keys, and asking the validated schema would turn "no
 * WhatsApp keys yet" into "the environment is invalid" on an unrelated path.
 */
function pickProvider(): Picked | null {
  const forced = process.env.WHATSAPP_PROVIDER?.trim().toLowerCase();

  const token = process.env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const base = (process.env.WHATSAPP_API_BASE?.trim() || META_DEFAULT_BASE).replace(/\/$/, "");
  const meta: Picked | null =
    token && phoneNumberId ? { provider: "meta", token, phoneNumberId, base } : null;

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM?.trim();
  const twilio: Picked | null =
    sid && authToken && from ? { provider: "twilio", sid, authToken, from } : null;

  if (forced === "meta") return meta;
  if (forced === "twilio") return twilio;
  return meta ?? twilio;
}

/** WhatsApp addresses are full international numbers, no plus, no spaces. */
function target(phone: string): string {
  return toMsisdn(phone);
}

interface TemplateSpec {
  /** Meta: the approved template NAME. Twilio: the Content SID (HX...). */
  templateId?: string;
  /** Values for the template's numbered slots, IN THE TEMPLATE'S OWN ORDER. */
  vars: string[];
  /** Approved language code, e.g. "en" or "en_US". Must match the template exactly. */
  language?: string;
  /** Human-readable rendering, for the log when nothing is configured. */
  preview: string;
  /** Short event name, so a failure in the log says which message it was. */
  label: string;
}

/**
 * Send one templated WhatsApp message. Never throws.
 *
 * THE ORDER TRAP IS THE SAME ONE AS DLT. A template is a row of anonymous
 * numbered slots and no provider checks that your values line up with them, so
 * a template written in a different order sends a confident, well-formatted
 * lie. Every caller documents the body it expects, verbatim.
 */
export async function sendWhatsAppTemplate(
  phone: string,
  spec: TemplateSpec
): Promise<WhatsAppOutcome> {
  // The kill switch, matching SMS_NOTIFICATIONS. WhatsApp templates cost money
  // per message, so there has to be a way to stop them that is not a redeploy.
  if (process.env.WHATSAPP_NOTIFICATIONS?.trim().toLowerCase() === "off") {
    return { sent: false, reason: "disabled" };
  }

  const picked = pickProvider();
  const templateId = spec.templateId?.trim();
  const to = target(phone);

  if (!picked || !templateId) {
    console.log(
      `[whatsapp:dev] ${spec.label} -> ${toBare10(phone)}: ${spec.preview}` +
        (picked ? "  (no approved template id configured)" : "  (no WhatsApp provider configured)")
    );
    return { sent: false, reason: picked ? "no-template" : "not-configured" };
  }
  if (!to || !isIndianMobile(phone)) {
    // A landline or a typo in the recipients list. Worth a line, because "the
    // report never arrived" is otherwise investigated as a provider fault.
    console.warn(`[whatsapp] ${spec.label}: not a mobile number, skipped`, { phone: toBare10(phone) });
    return { sent: false, reason: "not-mobile" };
  }

  if (picked.provider === "meta") {
    return metaSend(picked, spec.label, {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateId,
        language: { code: spec.language?.trim() || "en" },
        components: spec.vars.length
          ? [{ type: "body", parameters: spec.vars.map((v) => ({ type: "text", text: v })) }]
          : [],
      },
    });
  }

  // Twilio names template variables by POSITION as a JSON object: {"1":"..."}.
  const contentVariables = Object.fromEntries(spec.vars.map((v, i) => [String(i + 1), v]));
  return twilioSend(picked, spec.label, to, {
    ContentSid: templateId,
    ...(spec.vars.length ? { ContentVariables: JSON.stringify(contentVariables) } : {}),
  });
}

/**
 * Send plain text. Never throws.
 *
 * ONLY WORKS INSIDE THE 24-HOUR WINDOW - see the file header. Gated behind
 * WHATSAPP_ALLOW_FREE_TEXT so it cannot become the accidental default: a report
 * that silently stopped arriving at 9:30 PM because a window closed is worse
 * than one that never started.
 */
export async function sendWhatsAppText(
  phone: string,
  text: string,
  label: string
): Promise<WhatsAppOutcome> {
  if (process.env.WHATSAPP_NOTIFICATIONS?.trim().toLowerCase() === "off") {
    return { sent: false, reason: "disabled" };
  }
  if (process.env.WHATSAPP_ALLOW_FREE_TEXT?.trim().toLowerCase() !== "on") {
    return { sent: false, reason: "free-text-not-enabled" };
  }

  const picked = pickProvider();
  const to = target(phone);
  if (!picked) {
    console.log(`[whatsapp:dev] ${label} -> ${toBare10(phone)}:\n${text}`);
    return { sent: false, reason: "not-configured" };
  }
  if (!to || !isIndianMobile(phone)) {
    console.warn(`[whatsapp] ${label}: not a mobile number, skipped`, { phone: toBare10(phone) });
    return { sent: false, reason: "not-mobile" };
  }

  if (picked.provider === "meta") {
    return metaSend(picked, label, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      // Long reports carry no links worth unfurling, and a preview card on top
      // of a wall of numbers is noise.
      text: { preview_url: false, body: text },
    });
  }
  return twilioSend(picked, label, to, { Body: text });
}

async function metaSend(
  picked: Extract<Picked, { provider: "meta" }>,
  label: string,
  body: unknown
): Promise<WhatsAppOutcome> {
  let res: Response;
  try {
    res = await fetch(`${picked.base}/${picked.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${picked.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error(`[whatsapp:meta] ${label} network error`, (err as Error).message);
    return { sent: false, reason: "network", detail: (err as Error).message };
  }

  const json: { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null =
    await res.json().catch(() => null);

  if (!res.ok || json?.error) {
    // 131047 = outside the 24-hour window, 132001 = template does not exist,
    // 190 = the access token has expired. None of the three is fixed by
    // retrying, so the provider's own words go into the log verbatim.
    console.error(`[whatsapp:meta] ${label} failed`, { httpStatus: res.status, error: json?.error });
    const code = json?.error?.code;
    const config = code === 190 || code === 132001 || code === 131047 || res.status === 401;
    return {
      sent: false,
      reason: config ? "config" : "provider",
      detail: json?.error ?? { httpStatus: res.status },
    };
  }
  return { sent: true, id: json?.messages?.[0]?.id };
}

async function twilioSend(
  picked: Extract<Picked, { provider: "twilio" }>,
  label: string,
  to: string,
  fields: Record<string, string>
): Promise<WhatsAppOutcome> {
  const form = new URLSearchParams({
    From: picked.from.startsWith("whatsapp:") ? picked.from : `whatsapp:+${toMsisdn(picked.from)}`,
    To: `whatsapp:+${to}`,
    ...fields,
  });

  let res: Response;
  try {
    res = await fetch(`${TWILIO_BASE}/Accounts/${picked.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${picked.sid}:${picked.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error(`[whatsapp:twilio] ${label} network error`, (err as Error).message);
    return { sent: false, reason: "network", detail: (err as Error).message };
  }

  const json: { sid?: string; message?: string; code?: number } | null = await res
    .json()
    .catch(() => null);
  if (!res.ok) {
    console.error(`[whatsapp:twilio] ${label} failed`, { httpStatus: res.status, body: json });
    return { sent: false, reason: res.status === 401 ? "config" : "provider", detail: json };
  }
  return { sent: true, id: json?.sid };
}

/** Which provider is live right now - surfaced in admin settings. */
export function whatsappStatus(): {
  configured: boolean;
  provider: WhatsAppProvider | null;
  /** Whether the daily-report template id has been set. */
  reportTemplateReady: boolean;
  freeTextEnabled: boolean;
  disabled: boolean;
} {
  const picked = pickProvider();
  return {
    configured: !!picked,
    provider: picked?.provider ?? null,
    reportTemplateReady: Boolean(process.env.WHATSAPP_TPL_DAILY_REPORT?.trim()),
    freeTextEnabled: process.env.WHATSAPP_ALLOW_FREE_TEXT?.trim().toLowerCase() === "on",
    disabled: process.env.WHATSAPP_NOTIFICATIONS?.trim().toLowerCase() === "off",
  };
}
