import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  storageClient,
  s3Client,
  storageBackend,
  isSupabaseStorageConfigured,
  publicObjectUrl,
  PHI_BUCKET,
  PUBLIC_BUCKET,
} from "./storage-server";

export interface StoredFile {
  fileUrl: string;
  storage: "supabase" | "local";
}

/**
 * Storage for PATIENT RECORDS - prescription scans and lab reports. Every caller
 * of storeFile() is health data, so this module treats everything it holds as PHI.
 *
 * Bytes live in a PRIVATE Supabase Storage bucket. "Private" is the whole point:
 * the object has no public URL, and the only way to read it is this server, using
 * the service-role key, after /api/v1/files/prescriptions/[key] has checked who
 * is asking. Cloudinary was removed because its `secure_url` is public and
 * guessable - anyone with the link could read a patient's scan without signing in.
 * A Supabase PUBLIC bucket would have exactly the same defect, so the bucket must
 * stay private; see docs/supabase-storage.md for the one-time setup.
 *
 * The URL stored on the row is unchanged from the local-disk era
 * (/api/v1/files/prescriptions/<key>), so every existing record, print view and
 * portal link keeps working, and files written before this change are still
 * readable off local disk.
 */
const PRIVATE_DIR = path.join(process.cwd(), "storage", "prescriptions");
const URL_PREFIX = "/api/v1/files/prescriptions";

let warnedAboutLocalFallback = false;

/**
 * Store a patient-record file and return the gated URL to reach it.
 * Never a public link - the URL always points back at the authenticated route.
 */
export async function storeFile(
  buffer: Buffer,
  opts: { fileName: string; mimeType: string; folder?: string }
): Promise<StoredFile> {
  const key = generateKey(opts.fileName, opts.mimeType);
  const contentType = opts.mimeType || "application/octet-stream";

  const s3 = s3Client();
  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: PHI_BUCKET, Key: key, Body: buffer, ContentType: contentType,
    }));
    return { fileUrl: fileUrlForKey(key), storage: "supabase" };
  }

  const supabase = storageClient();
  if (supabase) {
    const { error } = await supabase.storage.from(PHI_BUCKET).upload(key, buffer, {
      contentType,
      // Keys carry 12 random bytes, so a collision means something is very wrong -
      // overwriting would silently destroy another patient's record.
      upsert: false,
    });
    if (error) throw new Error(`Could not store the file: ${error.message}`);
    return { fileUrl: fileUrlForKey(key), storage: "supabase" };
  }

  if (!warnedAboutLocalFallback) {
    warnedAboutLocalFallback = true;
    const message =
      "[storage] No Supabase Storage credentials - patient records are being " +
      "written to local disk. That is fine for development, but on a serverless " +
      "host the disk is ephemeral and these files WILL be lost. Set either " +
      "SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY, or " +
      "SUPABASE_SERVICE_ROLE_KEY (with SUPABASE_URL).";
    if (process.env.NODE_ENV === "production") console.error(message);
    else console.warn(message);
  }
  return saveLocally(buffer, key);
}

/**
 * Reads a stored file back. Used only by the authenticated file route.
 *
 * Tries Supabase first, then local disk. Both are checked on every read rather
 * than trusting the row's `storage` column, because records written before this
 * module changed are on disk and must keep opening.
 */
export async function readStoredFile(key: string): Promise<Buffer> {
  assertSafeKey(key);

  const s3 = s3Client();
  if (s3) {
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: PHI_BUCKET, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (bytes) return Buffer.from(bytes);
    } catch {
      // Fall through to disk - see below.
    }
  }

  const supabase = storageClient();
  if (supabase) {
    const { data, error } = await supabase.storage.from(PHI_BUCKET).download(key);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  }

  // Records uploaded before this app used object storage are still on disk, so
  // a miss above is not an error - it is the old file, and it must keep opening.
  return readFile(path.join(PRIVATE_DIR, key));
}

/** Removes a stored patient-record object. Best-effort - a miss is not an error. */
export async function deleteStoredFile(key: string): Promise<void> {
  assertSafeKey(key);
  const s3 = s3Client();
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: PHI_BUCKET, Key: key }));
    return;
  }
  const supabase = storageClient();
  if (supabase) await supabase.storage.from(PHI_BUCKET).remove([key]);
}

/** Rebuilds the gated URL for a stored key. */
export function fileUrlForKey(key: string): string {
  return `${URL_PREFIX}/${key}`;
}

/**
 * True when a stored URL is one this app can actually gate. A legacy row that
 * points at an external CDN is NOT gated - treat those as exposed and re-file
 * them rather than serving them as though they were safe.
 */
export function isGatedFileUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(`${URL_PREFIX}/`);
}

/**
 * Store a NON-PHI image in the public bucket and return its CDN URL.
 *
 * Doctor portraits only. This bucket is world-readable by design - the same
 * photo is already on the public directory page - so nothing patient-identifying
 * may ever be routed here. That is why it is a separate function with a separate
 * bucket rather than a `visibility` flag on storeFile(): a flag is one typo away
 * from publishing a scan.
 */
export async function storePublicImage(
  buffer: Buffer,
  opts: { fileName: string; mimeType: string; prefix?: string }
): Promise<string> {
  const key = `${opts.prefix ?? "doctors"}/${generateKey(opts.fileName, opts.mimeType)}`;
  const contentType = opts.mimeType || "image/jpeg";

  const s3 = s3Client();
  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: PUBLIC_BUCKET, Key: key, Body: buffer, ContentType: contentType,
    }));
    return publicObjectUrl(key);
  }

  const supabase = storageClient();
  if (supabase) {
    const { error } = await supabase.storage.from(PUBLIC_BUCKET).upload(key, buffer, {
      contentType, upsert: false,
    });
    if (error) throw new Error(`Could not upload the image: ${error.message}`);
    return publicObjectUrl(key);
  }

  // Named precisely, because this message is what the admin sees in the form.
  throw new Error(
    "Image uploads need Supabase Storage credentials in .env: either " +
      "SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY, or " +
      "SUPABASE_SERVICE_ROLE_KEY - plus SUPABASE_URL. Or paste an image URL instead."
  );
}

export { isSupabaseStorageConfigured };

// ---- internals ----

/** Path-traversal guard: a key is a generated filename, nothing else. */
function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) {
    throw new Error("Invalid file key");
  }
}

function generateKey(fileName: string, mimeType: string): string {
  const ext = path.extname(fileName) || mimeExt(mimeType);
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`;
}

/** Development fallback, OUTSIDE the web root. */
async function saveLocally(buffer: Buffer, key: string): Promise<StoredFile> {
  await mkdir(PRIVATE_DIR, { recursive: true });
  await writeFile(path.join(PRIVATE_DIR, key), buffer);
  return { fileUrl: fileUrlForKey(key), storage: "local" };
}

function mimeExt(mime: string): string {
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return "";
}
