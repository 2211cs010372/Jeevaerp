import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listDoctors } from "@/server/services/appointments.service";

export const dynamic = "force-dynamic";

/**
 * The roster, for naming the doctor on a lab order.
 *
 * Separate from /reception/doctors, which the lab cannot read: that one carries
 * the after-hours consultation pricing a booking screen needs, and this one is
 * a list of names for a dropdown. Same source, so the two can never disagree
 * about who works here.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN");
  const doctors = await listDoctors();
  return NextResponse.json({
    doctors: doctors.map((d) => ({
      id: d.id, name: d.name, specialization: d.specialization, department: d.department,
    })),
  });
});
