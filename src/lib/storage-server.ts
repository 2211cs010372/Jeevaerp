import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { S3Client } from "@aws-sdk/client-s3";

/**
 * SERVER-ONLY storage credentials. Nothing here may ever reach the browser.
 *
 * This is deliberately a separate module from `lib/supabase.ts` (the browser
 * client). That one carries the publishable key and is safe to ship; everything
 * here bypasses row-level security entirely. If it leaked to the client, a
 * patient could read every other patient's scans. Keeping them in different
 * files means an accidental `import … from "@/lib/supabase"` in a client
 * component cannot pick up the wrong one.
 *
 * TWO WAYS IN, because Supabase offers two and a hospital should not have to
 * hunt for the one this code happens to want:
 *
 *   S3 protocol   SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY
 *                 (Storage -> S3 connection in the dashboard)
 *   Native        SUPABASE_SERVICE_ROLE_KEY  (Project Settings -> API)
 *
 * S3 wins when both are present - it is the more explicitly scoped credential.
 * Both reach the same buckets and the rest of the app cannot tell them apart.
 */
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const s3AccessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID || "";
const s3SecretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY || "";
const s3Region = process.env.SUPABASE_S3_REGION || "ap-south-1";

/** Private bucket. Patient records only - never served directly to a browser. */
export const PHI_BUCKET = process.env.SUPABASE_PHI_BUCKET || "patient-records";
/** Public bucket. Doctor portraits for the directory + booking cards. */
export const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET || "doctor-photos";

/**
 * The S3 endpoint for this project.
 *
 * Derived from SUPABASE_URL rather than configured separately, because the two
 * must agree and a hand-typed mismatch fails at upload time with an opaque
 * signing error. Supabase serves S3 at <project>.storage.supabase.co, while the
 * REST API is at <project>.supabase.co - hence the substitution. An explicit
 * SUPABASE_S3_ENDPOINT still wins if a project ever needs a different host.
 */
function s3Endpoint(): string {
  const explicit = process.env.SUPABASE_S3_ENDPOINT;
  if (explicit) return explicit.replace(/\/$/, "");
  return `${url.replace(/\/$/, "").replace(".supabase.co", ".storage.supabase.co")}/storage/v1/s3`;
}

let supabase: SupabaseClient | null = null;
let s3: S3Client | null = null;

/** Which credential this deployment is actually using. */
export type StorageBackend = "s3" | "supabase" | "none";

export function storageBackend(): StorageBackend {
  if (url && s3AccessKeyId && s3SecretAccessKey) return "s3";
  if (url && serviceRoleKey) return "supabase";
  return "none";
}

/** The S3 client, or null when S3 credentials are not configured. */
export function s3Client(): S3Client | null {
  if (s3) return s3;
  if (storageBackend() !== "s3") return null;
  s3 = new S3Client({
    region: s3Region,
    endpoint: s3Endpoint(),
    credentials: { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey },
    // Supabase routes buckets by path (…/s3/<bucket>/<key>), not by a
    // bucket.host subdomain the way real S3 does.
    forcePathStyle: true,
  });
  return s3;
}

/** The native client, or null when the service-role key is not configured. */
export function storageClient(): SupabaseClient | null {
  if (supabase) return supabase;
  if (!url || !serviceRoleKey) return null;
  supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

export const isSupabaseStorageConfigured = storageBackend() !== "none";

/**
 * Public CDN URL for an object in the public bucket.
 *
 * Always the REST path, whichever protocol uploaded the bytes: this is the URL
 * an <img> on the public site fetches, and it does not go through S3.
 */
export function publicObjectUrl(path: string): string {
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${PUBLIC_BUCKET}/${path}`;
}
