/**
 * Calendar dates, in the clinic's own timezone.
 *
 * There are TWO kinds of date in this system and they are extracted differently.
 * Mixing them up is what put yesterday's stamp on a day-close report.
 *
 *  1. DATE-ONLY columns (`@db.Date`): Appointment.visitDate, DoctorSlot.date,
 *     StockBatch.expiryDate, Admission bed-stay days. Prisma writes these from
 *     the LOCAL calendar components and reads them back as UTC midnight of that
 *     same calendar day. So the calendar day is the UTC part -> `dateOnlyISO`.
 *
 *  2. TIMESTAMPS (`DateTime`): createdAt, completedAt, dischargedAt, payments.
 *     These are real instants. Which calendar day they fall on depends on the
 *     clinic's timezone -> `localDateISO`. Using the UTC part here files a
 *     10 PM IST payment under the previous day.
 *
 * And "what is today" is always `localDateISO()` - never `toISOString()`, which
 * returns YESTERDAY in a +offset zone like IST between 00:00 and 05:30.
 */

/** "YYYY-MM-DD" from LOCAL calendar components. Use for timestamps and "today". */
export function localDateISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" for a value read from a `@db.Date` column (stored at UTC midnight). */
export function dateOnlyISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Local midnight - the start of that calendar day. */
export function startOfLocalDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** The same clock time, N days later (or earlier). Does not mutate the input. */
export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

/**
 * Parse "YYYY-MM-DD" to local midnight of that calendar day.
 * `new Date("2026-07-23")` parses as UTC midnight, which is the *previous* day
 * in a -offset zone; this is unambiguous everywhere.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
