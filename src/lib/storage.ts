import { env } from "./env";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface StoredFile {
  fileUrl: string;
  storage: "cloudinary" | "local";
}

/**
 * Storage for PATIENT RECORDS - prescription scans and lab reports. Every caller
 * of storeFile() is health data, so this module treats everything it holds as PHI.
 *
 * Files are NOT served from /public: anything there is static and world-readable,
 * and the middleware matcher skips paths containing a dot, so a .pdf would be
 * public. They live outside the web root and are streamed only by
 * /api/v1/files/prescriptions/[key] after an auth + ownership check.
 *
 * There is deliberately NO object-storage upload path here. The previous
 * implementation fell back to Cloudinary, whose `secure_url` is PUBLIC and
 * guessable - anyone with the link could read a patient's scan without signing
 * in. Re-introducing a CDN for PHI needs private delivery (Cloudinary
 * `type=authenticated` + expiring signed URLs) AND a matching change to the file
 * route so it mints those signatures. Until that exists, keeping the bytes on
 * the hospital's own disk behind the auth gate is the correct default.
 */
const PRIVATE_DIR = path.join(process.cwd(), "storage", "prescriptions");
const URL_PREFIX = "/api/v1/files/prescriptions";

let warnedAboutCloudinary = false;

/**
 * Store a patient-record file and return the gated URL to reach it.
 * Always local, always behind /api/v1/files/... - never a public link.
 */
export async function storeFile(
  buffer: Buffer,
  opts: { fileName: string; mimeType: string; folder?: string }
): Promise<StoredFile> {
  const e = env();
  if (!warnedAboutCloudinary && (e.CLOUDINARY_CLOUD_NAME || e.CLOUDINARY_API_KEY || e.CLOUDINARY_API_SECRET)) {
    warnedAboutCloudinary = true;
    console.warn(
      "[storage] Cloudinary credentials are set but will NOT be used. Patient " +
      "records are stored on local disk behind the authenticated file route, " +
      "because Cloudinary's default delivery URL is public. See src/lib/storage.ts."
    );
  }
  return saveLocally(buffer, opts);
}

/** Reads a stored file back. Used only by the authenticated file route. */
export async function readStoredFile(key: string): Promise<Buffer> {
  // Path traversal guard: the key is a generated filename, nothing else.
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key.includes("..")) {
    throw new Error("Invalid file key");
  }
  return readFile(path.join(PRIVATE_DIR, key));
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

// ---- Local disk, OUTSIDE the web root ----
async function saveLocally(
  buffer: Buffer,
  opts: { fileName: string; mimeType: string }
): Promise<StoredFile> {
  await mkdir(PRIVATE_DIR, { recursive: true });
  const ext = path.extname(opts.fileName) || mimeExt(opts.mimeType);
  const key = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`;
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
