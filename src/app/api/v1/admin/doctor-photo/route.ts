import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { ApiError } from "@/lib/api";
import { storePublicImage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Portraits only. No PDFs - this bucket is public and feeds an <img>. */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Upload a doctor's portrait and return its public URL, for the admin to paste
 * into the doctor form (or for the form to fill in automatically).
 *
 * This goes to the PUBLIC bucket, which is correct and deliberate: the same
 * photograph is already on the hospital's public directory page. Nothing
 * patient-identifying may be sent here - patient records use storeFile(), which
 * writes to the private bucket behind the auth gate.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole(req, "ADMIN");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "No image uploaded");
    if (!ALLOWED.has(file.type)) throw new ApiError(400, "Only JPG, PNG, WebP or AVIF images are allowed");
    if (file.size > MAX_BYTES) throw new ApiError(400, "Image too large (max 5 MB)");

    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await storePublicImage(buffer, { fileName: file.name, mimeType: file.type, prefix: "doctors" });
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
    // storePublicImage throws a plain Error when Supabase isn't configured, and
    // that message tells the admin exactly what to set - so pass it through.
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[doctor photo upload] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
