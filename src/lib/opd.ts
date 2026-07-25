/**
 * OPD scheduling - the one source of truth for "when does this doctor sit?"
 *
 * Every Indian hospital lobby has a painted board: doctor, department, the
 * hours they consult, the days they come. Jeeva's board runs 08:00-20:00
 * (HOSPITAL.opdHours), and each doctor carries their own window inside it.
 *
 * This parsing used to live inside the booking form. That meant the doctors
 * directory and the profile page had no way to show timings without
 * re-implementing it - and a second implementation is a second chance to tell
 * a patient they can be seen at a time the booking form will then refuse.
 * It lives here now; the board, the profile and the slot picker all read it.
 */

/** The hospital's OPD day, in minutes from midnight. The band's full scale. */
export const BOARD_START = 8 * 60;   // 08:00
export const BOARD_END = 20 * 60;    // 20:00
export const BOARD_SPAN = BOARD_END - BOARD_START;

/** Sunday-first, matching Date.getDay(). */
export const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DAY_IDX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * A doctor who is available round the clock. The roster writes "Open 24 Hours".
 * These have a real slot diary (00:00-24:00) but no meaningful "window" to draw.
 */
export const is24Hours = (opd: string): boolean => /24\s*hours?|open\s*24/i.test(opd);

/**
 * A doctor with no published OPD window and no 24-hour cover - e.g. an
 * anaesthetist, booked through the surgical team rather than an online slot.
 * These have NO diary; the booking panel offers a call, not a grid.
 */
export const isByAppointment = (opd: string): boolean => !opdWindow(opd) && !is24Hours(opd);

/** "9:00 – 13:00" -> { start: 540, end: 780 }. Null when it can't be read. */
export function opdWindow(opd: string): { start: number; end: number } | null {
  const m = opd.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  return end > start ? { start, end } : null;
}

/** "9:00 – 13:00" -> ["09:00","09:30",…] in 30-minute steps. */
export function slotsFor(opd: string): string[] {
  const w = opdWindow(opd);
  if (!w) return [];
  const out: string[] = [];
  for (let t = w.start; t < w.end; t += 30) out.push(hhmm(t));
  return out;
}

/** Minutes from midnight -> "09:30". */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Minutes from midnight -> "9 AM" / "1:30 PM", for board tick labels. */
export function clockLabel(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Where a time sits across the board, as a percentage. Clamped to the board. */
export function boardPct(minutes: number): number {
  return Math.max(0, Math.min(100, ((minutes - BOARD_START) / BOARD_SPAN) * 100));
}

/** "Mon–Sat" / "Daily" / "Tue–Sat" -> the weekday indices the doctor consults. */
export function allowedDays(days: string): Set<number> {
  if (/daily/i.test(days)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const m = days.match(/([A-Za-z]{3})\s*[–-]\s*([A-Za-z]{3})/);
  if (!m || DAY_IDX[m[1]] === undefined || DAY_IDX[m[2]] === undefined) return new Set([1, 2, 3, 4, 5, 6]);
  const s = new Set<number>();
  for (let i = DAY_IDX[m[1]]; i <= DAY_IDX[m[2]]; i++) s.add(i);
  return s;
}

/**
 * How many hours a doctor is at the desk each consulting day.
 *
 * "Open 24 Hours" carries no parseable window, so this returned 0 and the
 * profile page read "At the desk · 0 hrs/day" for the very doctors who are
 * there round the clock. 24-hour cover is answered first; 0 is reserved for a
 * roster with genuinely nothing to measure ("By Appointment", "on call").
 */
export function dailyHours(opd: string): number {
  if (is24Hours(opd)) return 24;
  const w = opdWindow(opd);
  return w ? Math.round(((w.end - w.start) / 60) * 10) / 10 : 0;
}

/*
 * NOTE: a deterministic `isBooked()` used to live here, faking availability
 * before the diary was wired up. It is gone on purpose. Real availability now
 * comes from GET /api/v1/public/slots, which reads the same DoctorSlot rows
 * the reception desk books against - and a plausible-looking fake sitting
 * beside it is exactly the kind of thing that gets picked up by mistake and
 * ships a booking grid connected to nothing.
 *
 * The helpers below describe the SHAPE of a doctor's week (which days, which
 * hours). Whether a particular slot is free is a database question.
 */

/** The next date this doctor actually consults, as a local YYYY-MM-DD. */
export function nextConsultingDate(days: string, from = new Date()): string {
  const allowed = allowedDays(days);
  const d = new Date(from);
  for (let i = 0; i < 8; i++) {
    if (allowed.has(d.getDay())) break;
    d.setDate(d.getDate() + 1);
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "Mon–Sat" -> "Monday to Saturday", for prose. */
export function daysInWords(days: string): string {
  if (/daily/i.test(days)) return "Every day";
  const m = days.match(/([A-Za-z]{3})\s*[–-]\s*([A-Za-z]{3})/);
  if (!m) return days;
  return `${DAY_NAMES[DAY_IDX[m[1]] ?? 1]} to ${DAY_NAMES[DAY_IDX[m[2]] ?? 6]}`;
}
