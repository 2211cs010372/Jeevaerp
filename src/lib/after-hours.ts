/**
 * After-hours OP pricing - the one place that decides whether a visit falls
 * outside clinic hours and what it therefore costs.
 *
 * Pure string and number work, no Prisma and no Date-timezone traps beyond the
 * caller's own wall clock, so the desk, the booking service and the tests all
 * reach the same verdict for the same minute. If these two functions disagree
 * with each other the patient is quoted one fee and billed another, which is
 * the failure this module exists to prevent.
 */

export interface AfterHoursPolicy {
  enabled: boolean;
  /** Local "HH:MM", inclusive. */
  start: string;
  /** Local "HH:MM", exclusive. Earlier than `start` = the window crosses midnight. */
  end: string;
  /** What the day fee is multiplied by inside the window. */
  multiplier: number;
}

/** Minutes since local midnight, or null if this isn't an "HH:MM". */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "20:00" from a Date, read in whatever timezone the server is keeping. */
export function localHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Is this wall-clock time inside the after-hours window?
 *
 * Handles the overnight case, which is the normal one here: with 20:00→06:00 the
 * window is "at or after 20:00 OR before 06:00", not "between" - a naive
 * start <= t < end comparison returns false all night and the 2 AM emergency
 * gets charged a day fee.
 *
 * A malformed or empty window is treated as "not after hours". Failing open on
 * the CHEAPER fee is deliberate: a bad setting should never silently double what
 * a patient is charged.
 */
export function isAfterHours(hhmm: string, policy: AfterHoursPolicy): boolean {
  if (!policy.enabled) return false;
  const t = minutesOfDay(hhmm);
  const start = minutesOfDay(policy.start);
  const end = minutesOfDay(policy.end);
  if (t === null || start === null || end === null) return false;
  // start === end would mean a zero-length window; read it as "never", not "always".
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/**
 * The consultation fee for a visit at `hhmm`, given the doctor's day fee.
 *
 * Rounded to whole rupees: a 1.5× on ₹650 is ₹975, and a desk that has to
 * collect ₹975.50 in cash will round it anyway - better that the bill and the
 * drawer agree. A multiplier at or below 1 is ignored, so switching the feature
 * on with a nonsense value can't discount the day fee.
 */
export function opFeeFor(dayFee: number, hhmm: string, policy: AfterHoursPolicy): {
  fee: number;
  afterHours: boolean;
} {
  if (!(dayFee > 0) || !isAfterHours(hhmm, policy) || !(policy.multiplier > 1)) {
    return { fee: Math.max(0, Math.round(dayFee)), afterHours: false };
  }
  return { fee: Math.round(dayFee * policy.multiplier), afterHours: true };
}

/** "8:00 PM" - for telling the desk when the window opens. */
export function prettyTime(hhmm: string): string {
  const t = minutesOfDay(hhmm);
  if (t === null) return hhmm;
  const h24 = Math.floor(t / 60);
  const min = t % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
