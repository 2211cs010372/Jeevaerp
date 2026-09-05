import { prisma } from "@/lib/prisma";
import { addDateOnlyDays, localDateISO, parseDateOnly } from "@/lib/date";

/**
 * How far ahead the bookable grid runs, in days.
 *
 * One constant, because three places used to pick their own number and a grid
 * that stops before the date picker does reads to a patient as "fully booked"
 * rather than "not generated yet". The public doctor page already scans 21 days
 * looking for consulting dates, so anything under that starves it.
 */
export const SLOT_HORIZON_DAYS = 30;

/**
 * The consulting diary a newly created doctor gets: round the clock, seven days,
 * 15-minute cadence. It matches what the hospital advertises on every consultant
 * panel ("Open 24 Hours"); reception re-cuts it to 10 minutes from the booking
 * screen when the desk wants finer granularity.
 *
 * HERE, not in whichever service happens to add a doctor, because two services
 * do: admin creates a consultant with a login, reception creates a bookable
 * profile without one. They were separately written and they drifted - one of
 * them spelled the cadence at a column name that does not exist - so the diary
 * is defined once, next to the code that reads it back to build the grid.
 */
export const DIARY_START = "00:00";
export const DIARY_END = "24:00";
export const DIARY_SLOT_MIN = 15;

/** "HH:MM" -> minutes since midnight. "24:00" is a valid END of day. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Minutes since midnight -> "HH:MM".
 *
 * 1440 wraps to "00:00", not "24:00": a round-the-clock diary's last slot ends
 * at midnight, and "24:00" is not a time any parser here would read back.
 */
function toHHMM(mins: number): string {
  const wrapped = mins % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Generate concrete bookable slots for the next `days` days from every active
 * DoctorSchedule template. Idempotent: the [doctorId, date, startTime] unique
 * constraint means re-running never creates duplicates (skipDuplicates).
 *
 * Returns how many new slots were created - call this from a daily cron, or
 * on-demand before showing a booking screen.
 */
export async function generateSlots(days = SLOT_HORIZON_DAYS, doctorId?: string): Promise<{ created: number }> {
  const schedules = await prisma.doctorSchedule.findMany({
    // Scoped to one doctor when given: onboarding a single consultant should
    // build their diary, not walk every other doctor's grid for the horizon.
    where: { isActive: true, ...(doctorId ? { doctorId } : {}) },
    select: {
      doctorId: true, dayOfWeek: true, startTime: true, endTime: true, slotDurationMin: true,
    },
  });

  // DoctorSlot.date is @db.Date. Build it at UTC midnight of the clinic's
  // local calendar day - local midnight is 18:30 the previous day in IST, and
  // storing that put every generated slot in the wrong day's row.
  const today = parseDateOnly(localDateISO(new Date()));

  const rows: {
    doctorId: string; date: Date; startTime: string; endTime: string; isBooked: boolean;
  }[] = [];

  for (let d = 0; d < days; d++) {
    const date = addDateOnlyDays(today, d);
    const dow = date.getUTCDay(); // 0=Sun..6=Sat - UTC, to match the date above

    for (const sch of schedules) {
      if (sch.dayOfWeek !== dow) continue;
      const start = toMinutes(sch.startTime);
      const end = toMinutes(sch.endTime);
      for (let t = start; t + sch.slotDurationMin <= end; t += sch.slotDurationMin) {
        rows.push({
          doctorId: sch.doctorId,
          date,
          startTime: toHHMM(t),
          endTime: toHHMM(t + sch.slotDurationMin),
          isBooked: false,
        });
      }
    }
  }

  if (rows.length === 0) return { created: 0 };

  // Chunked. A round-the-clock diary across the full horizon is tens of
  // thousands of rows, and one createMany that size blows past Postgres'
  // 65535 bind-parameter ceiling.
  let created = 0;
  for (let i = 0; i < rows.length; i += 5000) {
    const result = await prisma.doctorSlot.createMany({
      data: rows.slice(i, i + 5000),
      skipDuplicates: true, // the unique [doctorId,date,startTime] makes this safe to re-run
    });
    created += result.count;
  }

  return { created };
}


/**
 * Switch the booking grid to a fresh cadence: set every active schedule's slot
 * length (default 10 min), drop future slots that are still free (keeping booked
 * and blocked ones untouched), then regenerate. Reception/admin action.
 */
export async function regenerateFutureSlots(minutes = 10, days = SLOT_HORIZON_DAYS): Promise<{ created: number; cleared: number }> {
  await prisma.doctorSchedule.updateMany({ where: { isActive: true }, data: { slotDurationMin: minutes } });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cleared = await prisma.doctorSlot.deleteMany({ where: { date: { gte: today }, isBooked: false, isBlocked: false } });
  const { created } = await generateSlots(days);
  return { created, cleared: cleared.count };
}
