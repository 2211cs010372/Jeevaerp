import { env } from "./env";

/**
 * EMAIL TRANSPORT - every message the hospital sends to an inbox.
 *
 * ─── TWO PROVIDERS, CHOSEN THE WAY lib/sms.ts CHOOSES ONE ──────────────────
 *
 *   SMTP (primary)  - the hospital's own Hostinger mailbox. SMTP_HOST,
 *                     SMTP_USER, SMTP_PASS. The sender is a real mailbox on
 *                     jeevamultispecialityhospital.com, so mail goes to ANY
 *                     recipient from the moment the password is set: no domain
 *                     verification, no sandbox, and replies land somewhere a
 *                     person actually reads.
 *
 *   Resend (fallback) - RESEND_API_KEY + EMAIL_FROM. Better deliverability
 *                     reporting at volume, and worth moving to if the mailbox
 *                     ever starts hitting its host's daily send limit.
 *
 * Selection is automatic: SMTP wins when its credentials are present, otherwise
 * Resend, otherwise the message is logged. EMAIL_PROVIDER forces one. Adding
 * credentials is the whole migration - there is no flag day and no window where
 * mail stops going out because a key was added in one place and removed from
 * another.
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

export type EmailProvider = "smtp" | "resend";

type Picked =
  | { provider: "smtp"; host: string; port: number; secure: boolean; user: string; pass: string; from: string }
  | { provider: "resend"; apiKey: string; from: string };

/**
 * Which transport to use, and whether we have one at all.
 *
 * Reads process.env directly rather than through env(), for the same reason
 * lib/sms.ts does: "is email configured" is a question about a handful of
 * optional keys, and routing it through the validated schema would make a
 * missing JWT secret surface as "email is not configured".
 */
function pickProvider(): Picked | null {
  const forced = process.env.EMAIL_PROVIDER?.trim().toLowerCase();

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  // 465 is implicit TLS, 587 is STARTTLS. Hostinger offers both; `secure` has
  // to match the port or the connection hangs until the socket times out
  // rather than failing with anything that names the cause.
  const port = Number(process.env.SMTP_PORT?.trim() || 465);
  const smtp: Picked | null =
    host && user && pass
      ? {
          provider: "smtp",
          host,
          port,
          secure: process.env.SMTP_SECURE?.trim()
            ? process.env.SMTP_SECURE.trim().toLowerCase() !== "false"
            : port === 465,
          user,
          pass,
          // For SMTP the authenticated mailbox IS a valid sender, so it is the
          // honest default - unlike Resend below, where a default sender would
          // be one that silently reaches nobody.
          from: process.env.EMAIL_FROM?.trim() || user,
        }
      : null;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  // Resend needs BOTH. The domain in `from` must be verified there, or every
  // send is refused - so there is deliberately no default sender: Resend's
  // sandbox address only delivers to the account owner, and a default would
  // produce a report that "sends successfully" and reaches nobody.
  const resend: Picked | null = apiKey && from ? { provider: "resend", apiKey, from } : null;

  if (forced === "smtp") return smtp;
  if (forced === "resend") return resend;
  return smtp ?? resend;
}

/**
 * Send one mail. Never throws.
 *
 * Recipients are passed as one message with several addressees, which puts
 * every admin on the same thread and lets them see each other - correct here,
 * because this is an internal distribution list and not a patient mailing.
 * Anything going to patients must send one message per person.
 */
export async function deliverEmail(spec: EmailSpec): Promise<EmailOutcome> {
  const to = spec.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "no-recipients" };

  const picked = pickProvider();
  if (!picked) {
    // Say what WOULD have gone out, so the log is readable by whoever is
    // setting the credentials up - the same contract lib/sms.ts keeps.
    console.log(`[email:dev] ${spec.label} -> ${to.join(", ")}: ${spec.subject}  (no email provider configured)`);
    return { sent: false, reason: "not-configured" };
  }

  return picked.provider === "smtp"
    ? sendViaSmtp(picked, to, spec)
    : sendViaResend(picked, to, spec);
}

async function sendViaSmtp(
  cfg: Extract<Picked, { provider: "smtp" }>,
  to: string[],
  spec: EmailSpec
): Promise<EmailOutcome> {
  try {
    // Imported here rather than at the top of the file so that the OTP path,
    // which may never send, does not drag a mail library into every module
    // that touches lib/email - and so nothing pulls it toward a client bundle.
    const mod = await import("nodemailer");
    const nodemailer = (mod as unknown as { default?: typeof mod }).default ?? mod;

    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      // No pooling: on a serverless host the function is frozen between
      // invocations and a pooled socket is dead by the time it is reused.
      pool: false,
      // Every one of these defaults to two minutes in nodemailer, which is
      // longer than the function is allowed to live. Failing at 20 seconds
      // with a reason beats being killed at 60 with none.
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 20_000,
    });

    const info = await transport.sendMail({
      from: cfg.from,
      to,
      subject: spec.subject,
      text: spec.text,
      html: spec.html,
      ...(spec.replyTo ? { replyTo: spec.replyTo } : {}),
      ...(spec.attachments?.length
        ? {
            attachments: spec.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.content, "base64"),
              ...(a.contentType ? { contentType: a.contentType } : {}),
            })),
          }
        : {}),
    });

    // A 2xx from the server is not the same as "every addressee was accepted" -
    // one bad address in the list is rejected on its own while the rest go out.
    const rejected = (info as { rejected?: unknown[] }).rejected ?? [];
    if (rejected.length) {
      console.warn(`[email:smtp] ${spec.label}: ${rejected.length} address(es) rejected`, rejected);
    }
    const accepted = (info as { accepted?: unknown[] }).accepted ?? [];
    if (accepted.length === 0) {
      return { sent: false, reason: "provider", detail: { rejected } };
    }
    return { sent: true, id: (info as { messageId?: string }).messageId };
  } catch (err) {
    const e = err as { code?: string; responseCode?: number; message?: string };
    // EAUTH and a 535 both mean the mailbox password is wrong or the host has
    // blocked the login. Neither is fixed by retrying, and telling somebody to
    // "try again" against a wrong password wastes the evening.
    const isAuth = e.code === "EAUTH" || e.responseCode === 535;
    const isNet =
      e.code === "ECONNECTION" || e.code === "ETIMEDOUT" || e.code === "ESOCKET" || e.code === "EDNS";
    console.error(`[email:smtp] ${spec.label} failed`, { code: e.code, responseCode: e.responseCode, message: e.message });
    if (isAuth) {
      console.error(
        "[email:smtp] THIS WILL NOT FIX ITSELF - check SMTP_USER is the full mailbox address " +
        "and SMTP_PASS is that mailbox's own password (not the hosting panel login)."
      );
    }
    return { sent: false, reason: isAuth ? "config" : isNet ? "network" : "provider", detail: e.message };
  }
}

async function sendViaResend(
  cfg: Extract<Picked, { provider: "resend" }>,
  to: string[],
  spec: EmailSpec
): Promise<EmailOutcome> {
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from,
        to,
        subject: spec.subject,
        html: spec.html,
        text: spec.text,
        ...(spec.replyTo ? { reply_to: spec.replyTo } : {}),
        ...(spec.attachments?.length
          ? {
              attachments: spec.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
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
    // The common two are worth naming: an unverified domain and a from address
    // that is not on it both come back as 403, and neither is fixed by retrying.
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
  if (!pickProvider()) {
    if (env().NODE_ENV === "production") {
      throw new Error("Email provider not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS, or RESEND_API_KEY and EMAIL_FROM.");
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
export function emailStatus(): {
  configured: boolean;
  provider: EmailProvider | null;
  from: string | null;
  /** SMTP only: the server being talked to, so a wrong host is visible. */
  host?: string;
  reason?: string;
} {
  const picked = pickProvider();
  if (picked?.provider === "smtp") {
    return { configured: true, provider: "smtp", from: picked.from, host: `${picked.host}:${picked.port}` };
  }
  if (picked?.provider === "resend") {
    return { configured: true, provider: "resend", from: picked.from };
  }

  // Say which half is missing. "Email is not configured" sends somebody to
  // check the key that is already there.
  const hasSmtpBits = !!(process.env.SMTP_HOST?.trim() || process.env.SMTP_USER?.trim() || process.env.SMTP_PASS);
  const reason = hasSmtpBits
    ? "SMTP is half-configured - SMTP_HOST, SMTP_USER and SMTP_PASS are all required"
    : process.env.RESEND_API_KEY?.trim()
      ? "EMAIL_FROM is not set"
      : process.env.EMAIL_FROM?.trim()
        ? "No SMTP credentials and no RESEND_API_KEY"
        : "No email provider is configured";
  return { configured: false, provider: null, from: process.env.EMAIL_FROM?.trim() ?? null, reason };
}

/** Masks an email for enumeration-safe display: r***@gmail.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "•••";
  const head = user.slice(0, 1);
  return `${head}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}
