/**
 * Creates the two Supabase Storage buckets this app needs, and verifies the
 * credentials in .env actually work.
 *
 *   npm run storage:setup
 *
 * Idempotent: a bucket that already exists is left alone and reported, so this
 * is safe to re-run after changing keys or pointing at a new project.
 *
 *   patient-records  PRIVATE  prescription scans + lab reports (PHI)
 *   doctor-photos    PUBLIC   doctor portraits on the public directory
 *
 * ONE IMPORTANT LIMIT. "Public" is a Supabase concept, not an S3 one, so the S3
 * protocol can create a bucket but cannot mark it public - S3 CreateBucket always
 * makes a private one. With only S3 keys this script therefore creates both and
 * tells you to flip doctor-photos to public with one toggle in the dashboard.
 * With SUPABASE_SERVICE_ROLE_KEY it sets both flags itself and nothing is left to do.
 *
 * Getting patient-records wrong in the other direction is the dangerous case, so
 * this script also CHECKS an existing patient-records bucket and shouts if it is
 * public - that would republish every scan on a guessable URL.
 */
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { S3Client, CreateBucketCommand, ListBucketsCommand } from "@aws-sdk/client-s3";

try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { }

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY || "";
const region = process.env.SUPABASE_S3_REGION || "ap-south-1";

const PHI_BUCKET = process.env.SUPABASE_PHI_BUCKET || "patient-records";
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET || "doctor-photos";

function endpoint(): string {
  const explicit = process.env.SUPABASE_S3_ENDPOINT;
  if (explicit) return explicit.replace(/\/$/, "");
  return `${url.replace(/\/$/, "").replace(".supabase.co", ".storage.supabase.co")}/storage/v1/s3`;
}

async function main() {
  if (!url) {
    console.error("\n  ✗ SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set in .env.\n");
    process.exit(1);
  }
  console.log(`\n  Project: ${url}`);
  console.log(`  Buckets: ${PHI_BUCKET} (private) · ${PUBLIC_BUCKET} (public)\n`);

  if (serviceRoleKey) {
    await withServiceRole();
  } else if (accessKeyId && secretAccessKey) {
    await withS3();
  } else {
    console.error("  ✗ No credentials. Set either:");
    console.error("      SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY   (Storage -> S3 connection)");
    console.error("      SUPABASE_SERVICE_ROLE_KEY                                    (Project Settings -> API)");
    console.error("\n    See docs/supabase-storage.md.\n");
    process.exit(1);
  }
}

/** The complete path: creates the buckets AND sets their public/private flag. */
async function withServiceRole() {
  console.log("  Using the service-role key (can set public/private).\n");
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error(`  ✗ Could not reach Storage: ${listErr.message}`);
    console.error("    Check SUPABASE_URL and that the key is the service_role one.\n");
    process.exit(1);
  }
  const byName = new Map((existing ?? []).map((b) => [b.name, b]));

  for (const [name, isPublic] of [[PHI_BUCKET, false], [PUBLIC_BUCKET, true]] as const) {
    const found = byName.get(name);
    if (!found) {
      const { error } = await supabase.storage.createBucket(name, { public: isPublic });
      if (error) { console.error(`  ✗ ${name}: ${error.message}`); process.exit(1); }
      console.log(`  ✓ created ${name} (${isPublic ? "public" : "private"})`);
      continue;
    }
    if (found.public === isPublic) {
      console.log(`  · ${name} already exists (${isPublic ? "public" : "private"}) - unchanged`);
      continue;
    }
    // Wrong visibility. For the PHI bucket this is a live exposure, so fix it
    // and say so loudly rather than reporting a tidy "already exists".
    const { error } = await supabase.storage.updateBucket(name, { public: isPublic });
    if (error) { console.error(`  ✗ ${name}: ${error.message}`); process.exit(1); }
    console.log(
      name === PHI_BUCKET && found.public
        ? `  ⚠ ${name} WAS PUBLIC - every scan in it had a working public URL. Set to private now.`
        : `  ✓ ${name} switched to ${isPublic ? "public" : "private"}`
    );
  }

  console.log("\n  Done. Nothing left to do - restart `npm run dev` and try an upload.\n");
}

/** S3 can create buckets, but every one it makes is private. */
async function withS3() {
  console.log(`  Using the S3 keys against ${endpoint()}\n`);
  const s3 = new S3Client({
    region, endpoint: endpoint(),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  let existing: string[];
  try {
    const res = await s3.send(new ListBucketsCommand({}));
    existing = (res.Buckets ?? []).map((b) => b.Name ?? "");
  } catch (e) {
    console.error(`  ✗ Could not reach Storage over S3: ${(e as Error).message}`);
    console.error("    Check the access key, the secret, and that SUPABASE_URL is this project.\n");
    process.exit(1);
  }

  for (const name of [PHI_BUCKET, PUBLIC_BUCKET]) {
    if (existing.includes(name)) { console.log(`  · ${name} already exists - unchanged`); continue; }
    try {
      await s3.send(new CreateBucketCommand({ Bucket: name }));
      console.log(`  ✓ created ${name} (private)`);
    } catch (e) {
      console.error(`  ✗ ${name}: ${(e as Error).message}`);
      process.exit(1);
    }
  }

  console.log(`\n  ONE MANUAL STEP LEFT. S3 cannot mark a bucket public, so ${PUBLIC_BUCKET}`);
  console.log("  was created private and doctor photos would 404 on the public site.");
  console.log(`\n    Dashboard -> Storage -> ${PUBLIC_BUCKET} -> ... -> Edit bucket -> turn ON "Public bucket"`);
  console.log(`\n  Leave ${PHI_BUCKET} PRIVATE. It holds patient scans, and this app streams`);
  console.log("  them through its own auth check - a public bucket would bypass that entirely.");
  console.log("\n  (Adding SUPABASE_SERVICE_ROLE_KEY to .env lets this script do that step too.)\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
