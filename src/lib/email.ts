import { env } from "./env";

/**
 * EMAIL TRANSPORT - every message the hospital sends to an inbox.
 *
 * ─── PROVIDER: RESEND ──────────────────────────────────────────────────────
 * Set RESEND_API_KEY (dashboard -> API Keys) and EMAIL_FROM. The domain in
 * EMAIL_FROM must be verified in Resend (Domains -> Add domain, then the three
 * DNS records), or every send is rejected. There is deliberately NO default
 * sender: Resend's sandbox address only delivers to the account owner, so a
 * default would produce a report that "sends successfully" and reaches nobody.
 *
 * Called over fetch rather than through the SDK on purpose - one dependency
 * fewer, and the request is three lines. Nothing here is Resend-shaped beyond
 * `deliverEmail`, so a second provider is one more branch in that function.
 *
 * ─── TWO CALLERS, TWO FAILURE RULES ────────────────────────────────────────
 * `sendOtpEmail` THROWS. It sits on a login path, and a code that never arrives
 * must surface as an error somebody can act on, not a silent dead end.
 *
 * `deliverEmail` NEVER throws. Its caller is the daily report, which runs after
 * the day's work is already committed - a provider outage must be a logged
 * `{ sent: false }`, not a crashed cron that hides which channels did go out.
 */

const RESEND_URL = "https://api.resend.com/emails";

/** A file rendered into the message. `content` is base64, no data: prefix. */
export interface EmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

export interface EmailSpec {
  to: string[];
  subject: string;
  html: string;
  /** Plain-text alternative. Not optional: a mail with no text part scores as spam. */
  text: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  /** Short event name, so a failure in the log says which mail it was. */
  label: string;
}

export type EmailOutcome = { sent: boolean; reason?: string; id?: string; detail?: unknown };

/**
 * Both halves of a working configuration, or null.
 *
 * Reads process.env directly rather than through env(), for the same reason
 * lib/sms.ts does: "is email configured" is a question about two optional keys,
 * and routing it through the validated schema would make a missing JWT secret
 * surface as "email is not configured".
 */
function pickResend(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

/**
 * Send one mail. Never throws.
 *
 * Recipients are passed to Resend as a `to` ARRAY, which puts every admin on the
 * same message and lets them see each other - correct here, because this is an
 * internal distribution list and not a patient mailing. Anything going to
 * patients must send one message per person.
 */
export async function deliverEmail(spec: EmailSpec): Promise<EmailOutcome> {
  const to = spec.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "no-recipients" };

  const picked = pickResend();
  if (!picked) {
    // Say what WOULD have gone out, so the log is readable by whoever is
    // setting the keys up - the same contract lib/sms.ts keeps.
    console.log(
      `[email:dev] ${spec.label} -> ${to.join(", ")}: ${spec.subject}` +
      (process.env.RESEND_API_KEY?.trim() ? "  (EMAIL_FROM is not set)" : "  (no RESEND_API_KEY)")
    );
    return { sent: false, reason: "not-configured" };
  }

  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${picked.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: picked.from,
        to,
        subject: spec.subject,
        html: spec.html,
        text: spec.text,
        ...(spec.replyTo ? { reply_to: spec.replyTo } : {}),
        ...(spec.attachments?.length
          ? { attachments: spec.attachments.map((a) => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) })) }
          : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error(`[email:resend] ${spec.label} network error`, (err as Error).message);
    return { sent: false, reason: "network", detail: (err as Error).message };
  }

  const body: { id?: string; message?: string; name?: string } | null = await res.json().catch(() => null);
  if (!res.ok) {
    // The most common two are worth naming: an unverified domain and a from
    // address that isn't on it both come back as 403, and neither is fixed by
    // retrying. Left in the log verbatim so the reason is the provider's own.
    console.error(`[email:resend] ${spec.label} failed`, { httpStatus: res.status, body, to });
    return { sent: false, reason: res.status === 403 || res.status === 401 ? "config" : "provider", detail: body };
  }
  return { sent: true, id: body?.id };
}

/**
 * Sends a staff login OTP by email.
 *
 * Throws when there is no provider in production, exactly as before - a login
 * code must never be silently dropped. In development it logs to the console.
 */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const picked = pickResend();
  if (!picked) {
    if (env().NODE_ENV === "production") {
      throw new Error("Email provider not configured. Set RESEND_API_KEY and EMAIL_FROM.");
    }
    // eslint-disable-next-line no-console
    console.log(`\n[email:dev] Staff OTP for ${to}: ${code}\n`);
    return;
  }

  const result = await deliverEmail({
    to: [to],
    subject: `${code} is your Jeeva Hospital sign-in code`,
    text: `Your Jeeva Hospital staff sign-in code is ${code}. It expires shortly. Do not share it with anyone.`,
    html:
      `<p style="font:15px system-ui,sans-serif">Your Jeeva Hospital staff sign-in code is</p>` +
      `<p style="font:700 30px/1.2 ui-monospace,monospace;letter-spacing:.12em">${code}</p>` +
      `<p style="font:13px system-ui,sans-serif;color:#667">It expires shortly. Do not share it with anyone.</p>`,
    label: "staff-otp",
  });
  if (!result.sent) throw new Error(`Could not send the sign-in code (${result.reason ?? "unknown"})`);
}

/** Whether mail can actually leave the building - surfaced in admin settings. */
export function emailStatus(): { configured: boolean; provider: "resend" | null; from: string | null; reason?: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && from) return { configured: true, provider: "resend", from };
  return {
    configured: false,
    provider: null,
    from: from ?? null,
    reason: !apiKey && !from ? "RESEND_API_KEY and EMAIL_FROM are not set" : !apiKey ? "RESEND_API_KEY is not set" : "EMAIL_FROM is not set",
  };
}

/** Masks an email for enumeration-safe display: r***@gmail.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}
