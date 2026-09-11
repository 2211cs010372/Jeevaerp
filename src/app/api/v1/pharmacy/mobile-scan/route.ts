import { NextRequest, NextResponse } from "next/server";
import {
  createSession,
  getSession,
  deleteSession,
} from "@/lib/pharmacy/mobile-scan-store";

/**
 * POST /api/v1/pharmacy/mobile-scan
 * Create a new mobile scan session. Called by the desktop when "Scan with
 * Mobile" is clicked.
 */
export async function POST() {
  const { sessionId, token } = createSession();
  return NextResponse.json({ sessionId, token });
}

/**
 * GET /api/v1/pharmacy/mobile-scan?sessionId=…
 * Poll for the mobile upload. Called every 2s by the desktop while the QR
 * modal is open.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: "Session expired or not found" },
      { status: 404 },
    );
  }

  if (session.status === "uploaded" && session.imageBase64) {
    // Desktop has the image — clean up immediately so RAM doesn't hold a
    // multi-MB base64 string for the remaining 10 minutes of the TTL.
    const payload = {
      status: "uploaded" as const,
      imageBase64: session.imageBase64,
      imageMime: session.imageMime,
    };
    deleteSession(sessionId);
    return NextResponse.json(payload);
  }

  return NextResponse.json({ status: "waiting" });
}
