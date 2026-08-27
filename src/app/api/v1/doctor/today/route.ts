import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { doctorToday, completeConsultation } from "@/server/services/doctor.service";
import { z } from "zod";
export const dynamic = "force-dynamic";

/**
 * Today's clinic list. ADMIN reads it too - the portal access model already
 * lets an admin into the consulting room, and until now this route was the
 * thing that stopped them once they got there. They pass `?doctorId=` to say
 * whose day; without it the service answers with the roster to choose from.
 */
export const GET = handler(async (req) => {
  const actor = await requireRole(req, "DOCTOR", "ADMIN");
  const doctorId = req.nextUrl.searchParams.get("doctorId") ?? undefined;
  return NextResponse.json(await doctorToday(actor, doctorId));
});

/** Mark a consultation done. DOCTOR only - see completeConsultation. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "DOCTOR");
  const { appointmentId } = await parseBody(req, z.object({ appointmentId: z.string().trim().min(1) }));
  await completeConsultation(actor, appointmentId);
  return NextResponse.json({ ok: true });
});
