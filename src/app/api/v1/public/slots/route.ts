import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { listAvailableSlots } from "@/server/services/appointments.service";

export const dynamic = "force-dynamic";

/**
 * Open availability for the public booking surface.
 *
 * Same source of truth as the reception desk's /reception/slots - it calls
 * `listAvailableSlots`, so the website can never advertise a time the desk has
 * already filled. The difference is only the gate: reception's copy is behind a
 * staff role because it sits inside the ERP, and a patient choosing a time on
 * the website has no session to check.
 *
 * What is deliberately NOT exposed: slot ids are returned (they're needed to
 * book) but nothing about who holds the booked ones. Only free, unblocked slots
 * are ever returned, so this leaks no patient information.
 *
 * `doctor` may be a database id OR the doctor's printed name, because the
 * public site's pages are built from the marketing roster and know the name
 * long before they know the ERP's id.
 */
export const GET = handler(async (req) => {
  const { searchParams } = new URL(req.url);
  const doctorParam = searchParams.get("doctor")?.trim();
  const date = searchParams.get("date")?.trim();

  if (!doctorParam) throw new ApiError(400, "A doctor is required");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, "A date (YYYY-MM-DD) is required");

  const doctor = await prisma.doctor.findFirst({
    where: {
      active: true,
      OR: [{ id: doctorParam }, { name: { equals: doctorParam, mode: "insensitive" } }],
    },
    select: { id: true, name: true, consultationFee: true },
  });

  // Not every consultant on the website is on the ERP roster yet. Say so
  // plainly rather than returning an empty grid that reads as "fully booked".
  if (!doctor) {
    return NextResponse.json({ doctor: null, slots: [], reason: "not-on-roster" });
  }

  const slots = await listAvailableSlots(doctor.id, date);

  // Today's slots that have already passed are not bookable. The desk greys
  // them out because a receptionist can still register a walk-in against one;
  // on the website they are simply gone.
  const now = new Date();
  const isToday = date === localISO(now);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const open = slots.filter((s) => {
    if (!isToday) return true;
    const [h, m] = s.startTime.split(":").map(Number);
    return h * 60 + m > nowMins;
  });

  return NextResponse.json({
    doctor: { id: doctor.id, name: doctor.name, fee: doctor.consultationFee.toString() },
    slots: open,
  });
});

function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
