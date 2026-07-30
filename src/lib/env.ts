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
