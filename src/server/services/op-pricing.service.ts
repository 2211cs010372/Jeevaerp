import { prisma } from "@/lib/prisma";
import type { AfterHoursPolicy } from "@/lib/after-hours";

/**
 * Reads the after-hours OP policy: when the clinic day ends, and what a visit
 * costs once it has.
 *
 * Its own module rather than a function in admin.service, because both the
 * booking service (which prices a visit) and the admin settings screen (which
 * edits the policy) need it, and admin.service already imports from
 * appointments.service - putting it in either one would close an import cycle.
 *
 * One source of truth on purpose: the fee quoted at the desk and the fee written
 * on the bill are computed from the same row, so they cannot drift apart.
 *
 * A MISSING config row falls back to the schema defaults rather than to "off":
 * 20:00-06:00 at 2x is the hospital's stated practice, and a fresh install
 * should charge the night shift correctly without anyone visiting a settings
 * screen first.
 */
export async function getAfterHoursOpPolicy(): Promise<AfterHoursPolicy> {
  const c = await prisma.hospitalConfig.findFirst({
    select: {
      afterHoursOpEnabled: true, afterHoursOpStart: true,
      afterHoursOpEnd: true, afterHoursOpMultiplier: true,
    },
  });
  return {
    enabled: c?.afterHoursOpEnabled ?? true,
    start: c?.afterHoursOpStart?.trim() || "20:00",
    end: c?.afterHoursOpEnd?.trim() || "06:00",
    multiplier: c ? Number(c.afterHoursOpMultiplier) : 2,
  };
}
