import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 chars"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 chars"),
  ACCESS_TOKEN_TTL: z.string().default("12h"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  COOKIE_DOMAIN: z.string().optional(),
  // Cloud file storage (Supabase Storage). All optional - absence => local disk
  // fallback, which is fine in development and lossy on a serverless host.
  //
  // Two accepted credentials, S3 preferred when both are set. Every one of these
  // is server-side ONLY and must never carry a NEXT_PUBLIC_ prefix: they bypass
  // row-level security. See src/lib/storage-server.ts.
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_S3_ACCESS_KEY_ID: z.string().optional(),
  SUPABASE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  SUPABASE_S3_REGION: z.string().default("ap-south-1"),
  /** Overrides the endpoint derived from SUPABASE_URL. Rarely needed. */
  SUPABASE_S3_ENDPOINT: z.string().optional(),
  /** Private bucket holding prescription scans + lab reports. */
  SUPABASE_PHI_BUCKET: z.string().default("patient-records"),
  /** Public bucket holding doctor portraits. */
  SUPABASE_PUBLIC_BUCKET: z.string().default("doctor-photos"),
  // SMS delivery. Optional - absence => dev console log, or a hard failure in
  // production. See lib/sms.ts for how one is chosen.
  //
  // Fast2SMS is the primary provider; 2Factor is kept as a fallback so adding
  // the new key is the whole migration. SMS_PROVIDER forces one when both keys
  // are present.
  FAST2SMS_API_KEY: z.string().optional(),
  TWO_FACTOR_API_KEY: z.string().optional(),
  SMS_PROVIDER: z.enum(["fast2sms", "2factor"]).optional(),
  /** DLT-approved template id, required only for the appointment confirmation. */
  SMS_APPOINTMENT_TEMPLATE: z.string().optional(),
  /** DLT-approved 6-character sender header, e.g. JEEVAH. */
  SMS_SENDER_ID: z.string().optional(),
  // ---- Event notification templates (src/server/services/notify.service.ts) ----
  //
  // Every one is a SEPARATE DLT registration with its own Message ID. All are
  // optional and all are independent: an unregistered one logs its message
  // instead of sending, so the hospital can switch notifications on a few at a
  // time as approvals come back, rather than waiting for the whole set.
  //
  // The variable ORDER each template must use is documented beside its sender
  // in notify.service.ts. Nothing validates it - see the warning there.
  // No SMS_TPL_OP_BOOKED: both booking paths reuse SMS_APPOINTMENT_TEMPLATE,
  // because a patient cannot tell whether reception or the website typed it.
  SMS_TPL_OP_CANCELLED: z.string().optional(),
  SMS_TPL_BILL: z.string().optional(),
  SMS_TPL_PHARMACY_BILL: z.string().optional(),
  SMS_TPL_LAB_REPORT: z.string().optional(),
  SMS_TPL_ADMITTED: z.string().optional(),
  SMS_TPL_DISCHARGED: z.string().optional(),
  SMS_TPL_ADVANCE: z.string().optional(),
  SMS_TPL_SUPPLIER_PO: z.string().optional(),
  SMS_TPL_STOCK_RECEIVED: z.string().optional(),
  SMS_TPL_LOW_STOCK: z.string().optional(),
  /** Comma-separated mobile numbers that receive the stock/admin alerts. */
  SMS_ADMIN_NUMBERS: z.string().optional(),
  /** Set to "off" to stop every notification SMS. Never affects OTP. */
  SMS_NOTIFICATIONS: z.string().optional(),

  // ---- Email (src/lib/email.ts) ----
  //
  // Two providers, chosen automatically from whichever credentials are present;
  // EMAIL_PROVIDER forces one. Nothing set => the message is logged instead of
  // sent, except a staff OTP in production, which throws rather than silently
  // dropping a login code.
  //
  // SMTP is the primary: the hospital's own Hostinger mailbox sends to any
  // recipient the moment the password is set, with no domain verification.
  /** e.g. smtp.hostinger.com */
  SMTP_HOST: z.string().optional(),
  /** 465 (implicit TLS) or 587 (STARTTLS). Defaults to 465. */
  SMTP_PORT: z.string().optional(),
  /** Overrides the TLS mode implied by the port. Rarely needed. */
  SMTP_SECURE: z.string().optional(),
  /** The FULL mailbox address, e.g. info@jeevamultispecialityhospital.com */
  SMTP_USER: z.string().optional(),
  /** That mailbox's own password - not the hosting panel login. */
  SMTP_PASS: z.string().optional(),
  /** Resend API key. Dashboard -> API Keys. The fallback provider. */
  RESEND_API_KEY: z.string().optional(),
  /** e.g. `Jeeva Hospital <reports@jeevamultispecialityhospital.com>`.
   *  Optional on SMTP (defaults to SMTP_USER); REQUIRED by Resend, whose
   *  domain must be verified there or every send is refused. */
  EMAIL_FROM: z.string().optional(),
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).optional(),

  // ---- WhatsApp (src/lib/whatsapp.ts) ----
  //
  // Two providers, chosen automatically from whichever keys are present;
  // WHATSAPP_PROVIDER forces one. Nothing set => messages are logged, which is
  // the honest state until a Meta business account and an approved template
  // exist. See the file header for the 24-hour-window rule.
  WHATSAPP_PROVIDER: z.enum(["meta", "twilio"]).optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  /** Overrides Meta's graph host - for a BSP that proxies the same request shape. */
  WHATSAPP_API_BASE: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  /** Approved template NAME (Meta) or Content SID (Twilio) for the daily report. */
  WHATSAPP_TPL_DAILY_REPORT: z.string().optional(),
  /** Template language code. Must match the approved template exactly. */
  WHATSAPP_TPL_LANG: z.string().optional(),
  /** "on" allows plain-text sends - only works inside the 24-hour window. */
  WHATSAPP_ALLOW_FREE_TEXT: z.string().optional(),
  /** "off" stops every WhatsApp message, the twin of SMS_NOTIFICATIONS. */
  WHATSAPP_NOTIFICATIONS: z.string().optional(),

  // ---- The daily report (src/server/services/daily-report.service.ts) ----
  //
  // Recipients are edited on the admin settings screen and stored on
  // HospitalConfig; these two are the FALLBACK for whichever list is still
  // blank there, and the only source in the window between deploying this and
  // running the migration.
  REPORT_EMAILS: z.string().optional(),
  REPORT_WHATSAPP_NUMBERS: z.string().optional(),
  /**
   * Shared secret for /api/v1/cron/daily-report. Set it on the Vercel project
   * and Vercel sends it as a Bearer token on every scheduled call. WITHOUT IT
   * THE ENDPOINT REFUSES TO RUN - it reads the whole hospital's takings and
   * mails them, so an unauthenticated version of it is a scheduled data leak.
   */
  CRON_SECRET: z.string().optional(),
});

/**
 * Validated lazily (first import inside a request) so `next build`
 * doesn't demand production secrets at compile time.
 */
let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}
