import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/api";
import { requireAuth } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";
import { opdPrintData } from "@/server/services/appointments.service";

export const dynamic = "force-dynamic";

/**
 * The signed-in patient's own OPD case sheet. Same live sheet the desk prints
 * (opdPrintData), but a patient may only open a visit that is theirs - so we
 * gate on ownership before handing back the bundle.
 */
export const GET = handler(async (req, ctx) => {
  const caller = await requireAuth(req);
  if (caller.role !== "PATIENT") throw new ApiError(403, "Patients only");
  const { id } = await ctx.params;
  const appt = await prisma.appointment.findUnique({ where: { id }, select: { patientId: true } });
  if (!appt || appt.patientId !== caller.id) throw new ApiError(404, "Appointment not found");
  return NextResponse.json(await opdPrintData(id));
});
