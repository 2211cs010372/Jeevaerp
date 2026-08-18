import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { admissionSheet } from "@/server/services/ipd.service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The running tab, plus the letterhead it prints under.
 *
 * A SEPARATE ROUTE FROM `/sheet` on purpose. The stay screen polls that one on
 * every live event, and the only thing missing from it here is the hospital
 * config - which carries `logoDataUrl`, a base64 image. Folding that into the
 * screen's own payload would ship the letterhead again on every ward update,
 * for a field the screen never renders.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const [sheet, hospital] = await Promise.all([
    admissionSheet(id),
    prisma.hospitalConfig.findFirst({
      select: {
        legalName: true, addressLine: true, city: true, state: true,
        pincode: true, phone: true, gstin: true, logoDataUrl: true,
      },
    }),
  ]);
  return NextResponse.json({ ...sheet, hospital });
});
