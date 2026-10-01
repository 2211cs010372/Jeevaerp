import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { outstandingAdvisedLabs, advisedLabsForAppointment } from "@/server/services/prescriptions.service";

export const dynamic = "force-dynamic";

/**
 * Tests the doctor advised that nobody has ordered yet.
 *
 * Without `?appointmentId`, this is the whole desk's outstanding list - the
 * safety net. A per-visit view only helps the person who happens to reopen that
 * visit, and the reason an advised test gets missed is precisely that nobody
 * goes looking for it.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "LAB_TECH");
  const url = new URL(req.url);
  const appointmentId = url.searchParams.get("appointmentId");

  if (appointmentId) {
    return NextResponse.json({ advised: await advisedLabsForAppointment(appointmentId) });
  }

  const limit = Number(url.searchParams.get("limit")) || undefined;
  return NextResponse.json(await outstandingAdvisedLabs(limit));
});
