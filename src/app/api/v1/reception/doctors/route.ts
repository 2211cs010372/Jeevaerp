import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listDoctors } from "@/server/services/appointments.service";
import { getAfterHoursOpPolicy } from "@/server/services/op-pricing.service";
import { localHHMM } from "@/lib/after-hours";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const [doctors, policy] = await Promise.all([listDoctors(), getAfterHoursOpPolicy()]);
  // The after-hours policy rides along on the call the booking screen already
  // makes, so the desk can show the emergency fee without a second round trip.
  //
  // `serverTime` is included because the fee has to be judged against the clock
  // that will actually price the booking. A desk PC whose clock is off by twenty
  // minutes would otherwise quote ₹600 at 19:50 and be handed ₹1,200 by the
  // server - the patient told one number and billed another.
  return NextResponse.json({
    doctors,
    opPricing: { ...policy, serverTime: localHHMM(new Date()) },
  });
});
