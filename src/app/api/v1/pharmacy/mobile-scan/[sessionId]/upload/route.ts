import { NextRequest, NextResponse } from "next/server";
import { uploadToSession } from "@/lib/pharmacy/mobile-scan-store";

/**
 * POST /api/v1/pharmacy/mobile-scan/[sessionId]/upload?t=TOKEN
 * Receives the invoice image from the phone. The token in the query string is
 * the one-time credential the QR code carried — it proves the phone that
 * scanned the QR is the one uploading.
 *
 * Accepts multipart/form-data with a single `file` field.
 * Max image size: 10 MB (plenty for a phone photo).
 */
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const token = req.nextUrl.searchParams.get("t");

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Image too large — max 10 MB" },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mime = file.type || "image/jpeg";

    const ok = uploadToSession(sessionId, token, base64, mime);
    if (!ok) {
      return NextResponse.json(
        { error: "Session expired or invalid token" },
        { status: 403 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not process the upload" },
      { status: 500 },
    );
  }
}
