import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/guard";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { readStoredFile, fileUrlForKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Roles that may read any patient's prescription scan. */
const CLINICAL_ROLES = ["RECEPTIONIST", "PHARMACIST", "DOCTOR", "ADMIN"];

/** Lab reports carry no stored mimeType, so fall back to the key's extension. */
function contentTypeFor(key: string): string {
  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

/**
 * Streams a patient health-record file - a prescription scan OR a lab report.
 *
 * Both are stored locally under the same key space and share this URL prefix,
 * so this one gate serves both. These are NOT in /public. Every read goes
 * through it:
 *   - clinical staff  -> any file
 *   - a patient       -> only their own files
 *   - anyone else     -> 401/403
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  try {
    const user = await requireAuth(req);
    const { key } = await ctx.params;
    const url = fileUrlForKey(key);

    // The key belongs to either a prescription upload or a lab report. Resolve
    // whichever owns it, so we know the patient (for the ownership check) and
    // how to label the download.
    const upload = await prisma.prescriptionUpload.findFirst({
      where: { fileUrl: url },
      select: { patientId: true, mimeType: true, fileName: true },
    });
    const report = upload
      ? null
      : await prisma.labTest.findFirst({
          where: { reportFileUrl: url },
          select: { patientId: true, testName: true },
        });

    const owner = upload
      ? { patientId: upload.patientId, mimeType: upload.mimeType, fileName: upload.fileName }
      : report
      ? { patientId: report.patientId, mimeType: null as string | null, fileName: report.testName }
      : null;
    if (!owner) throw new ApiError(404, "File not found");

    // Patients may only open their own files.
    if (!CLINICAL_ROLES.includes(user.role)) {
      if (user.role !== "PATIENT" || user.id !== owner.patientId) {
        throw new ApiError(403, "Not permitted to view this file");
      }
    }

    const buffer = await readStoredFile(key);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": owner.mimeType || contentTypeFor(key),
        // inline so the reader can just look at it in the tab
        "Content-Disposition": `inline; filename="${encodeURIComponent(owner.fileName || "record")}"`,
        // never let a shared proxy or the browser cache a medical record
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // A missing file on disk lands here - don't leak the path.
    console.error("[file serve] error:", err);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
