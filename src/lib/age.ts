/**
 * How old the patient is, when "how old" isn't a number of years.
 *
 * A lab counter registers newborns. "Age 0" is not an answer for a baby that is
 * eleven days old - it is the same answer the form gives for a baby that is
 * eleven months old, and several analytes are read differently across exactly
 * that gap (bilirubin in the first week, haemoglobin through the first year).
 * So the walk-in form takes a NUMBER AND A UNIT - 11 days, 5 months, 34 years -
 * and this module is the one place that knows how to move between them.
 *
 * WHERE IT IS KEPT. There is no "age unit" column, and inventing one would put
 * a value in the database that goes stale the moment the child has a birthday:
 * a row saying "11 days" is wrong by next month and nothing goes back to fix
 * it. So a fine-grained age is stored as the DATE OF BIRTH it implies, which is
 * the one form of the answer that stays true, and `Patient.age` keeps holding
 * completed years the way every existing screen expects. Both are written; the
 * display below prefers the date, because it is the one that can still tell a
 * newborn from a toddler.
 *
 * The dob this derives is an INFERENCE from what the parent said at the window,
 * not a birth certificate - same as every other hospital system that is handed
 * "three months old" and has a date column to fill.
 */

import { localDateISO, parseLocalDate, startOfLocalDay } from "./date";

export type AgeUnit = "Y" | "M" | "D";

export const AGE_UNITS: { value: AgeUnit; label: string; short: string }[] = [
  { value: "Y", label: "Years", short: "y" },
  { value: "M", label: "Months", short: "m" },
  { value: "D", label: "Days", short: "d" },
];

/**
 * The largest each unit will take, set well past where anyone actually uses it:
 * nobody says "500 days old", but a technician who writes 400 days for a
 * 13-month-old is not making a mistake and should not be argued with. What gets
 * refused is only a slip of the keyboard - a value that would write a date of
 * birth in the future or in the 1800s. The number also has to read sensibly
 * back at the desk, since it is what the error line quotes.
 */
export const AGE_MAX: Record<AgeUnit, number> = { Y: 120, M: 240, D: 400 };

export const ageInRange = (value: number, unit: AgeUnit) =>
  Number.isInteger(value) && value >= 0 && value <= AGE_MAX[unit];

/**
 * The date of birth implied by "N units old", as "YYYY-MM-DD".
 *
 * Month and year arithmetic CLAMPS the day rather than letting it roll over:
 * one month before 31 March is 28 February, not 3 March, which is what
 * `setMonth` alone would give you.
 */
export function dobFromAge(value: number, unit: AgeUnit, today: Date = new Date()): string {
  const t = startOfLocalDay(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  const d = t.getDate();

  if (unit === "D") {
    const x = new Date(y, m, d - value);
    return localDateISO(x);
  }

  const monthsBack = unit === "Y" ? value * 12 : value;
  const targetMonth = m - monthsBack;
  const targetYear = y + Math.floor(targetMonth / 12);
  const normMonth = ((targetMonth % 12) + 12) % 12;
  // Day 0 of the following month is the last day of this one - the clamp.
  const lastDay = new Date(targetYear, normMonth + 1, 0).getDate();
  return localDateISO(new Date(targetYear, normMonth, Math.min(d, lastDay)));
}

/**
 * The columns a typed age writes.
 *
 * YEARS WRITE NO DOB. An adult who says "34" has not told us their birthday,
 * and deriving one puts a date on the record that reception's patient screen
 * will show as fact - with a birthday that is always today. So years keep the
 * existing behaviour exactly: the `age` column, and nothing else.
 *
 * Months and days DO write one, because there is nowhere else for the answer to
 * live: `age` rounds both of them to 0. The date is out by at most the few days
 * of slack in what the parent said, and unlike a stored "11 days" it stays
 * right as the child grows.
 */
export function agePayload(value: number, unit: AgeUnit, today: Date = new Date()): { age: number; dob?: string } {
  const age = ageYears(value, unit);
  return unit === "Y" ? { age } : { age, dob: dobFromAge(value, unit, today) };
}

/** Completed years, for the `Patient.age` column every other screen reads. */
export function ageYears(value: number, unit: AgeUnit): number {
  if (unit === "Y") return value;
  if (unit === "M") return Math.floor(value / 12);
  return Math.floor(value / 365.25);
}

/** How long ago a date of birth was, in whole years, months and days. */
export function ageParts(dobISO: string, today: Date = new Date()): { years: number; months: number; days: number } {
  const dob = parseLocalDate(dobISO);
  const t = startOfLocalDay(today);

  let months = (t.getFullYear() - dob.getFullYear()) * 12 + (t.getMonth() - dob.getMonth());
  if (t.getDate() < dob.getDate()) months -= 1;
  if (months < 0) months = 0;

  const days = Math.max(0, Math.round((t.getTime() - dob.getTime()) / 86_400_000));

  return { years: Math.floor(months / 12), months, days };
}

/**
 * A date of birth read back as the number and unit it would be SAID as: days
 * under a month, months under two years, years after that - the way a
 * paediatrician says it out loud, and the way a parent answered the question in
 * the first place.
 *
 * One rule, in one place, because both ends need it: the display below prints
 * by it, and the registration form fills its own age box from it when the desk
 * picks a date instead of typing an age.
 */
export function ageFromDob(dobISO: string, today: Date = new Date()): { value: number; unit: AgeUnit } {
  const { years, months, days } = ageParts(dobISO, today);
  if (years >= 2) return { value: years, unit: "Y" };
  if (months >= 1) return { value: months, unit: "M" };
  return { value: days, unit: "D" };
}

/**
 * What a chip, a table cell or a report should print.
 *
 * Falls back to the years column for the patients registered before the form
 * could ask for a unit - null when nobody ever asked at all, which prints as a
 * dash rather than as "0".
 */
export function formatAge(
  p: { age?: number | null; dob?: string | null } | null | undefined,
  opts: { long?: boolean } = {},
  today: Date = new Date()
): string | null {
  if (!p) return null;
  const long = opts.long ?? false;
  const unit = (n: number, u: AgeUnit) => {
    const short = AGE_UNITS.find((x) => x.value === u)!.short;
    if (!long) return `${n}${short}`;
    const word = u === "Y" ? "year" : u === "M" ? "month" : "day";
    return `${n} ${word}${n === 1 ? "" : "s"}`;
  };

  if (p.dob) {
    const said = ageFromDob(p.dob, today);
    return unit(said.value, said.unit);
  }
  if (p.age != null) return unit(p.age, "Y");
  return null;
}
