import { describe, it, expect } from "vitest";
import { resolveChargeDate, ChargeDateError } from "@/server/billing/calc";

/**
 * THE DATE A RUNNING-TAB LINE CARRIES.
 *
 * The tab prints a "Date & time" against every charge, and it used to be
 * whenever the desk found a minute to key the line in - so a morning of rounds,
 * oxygen and dressings entered at 4pm printed as four days of treatment under
 * one afternoon. The date is correctable now, and these are the edges of what
 * may be typed.
 *
 * The window is the STAY, not the calendar: a charge before the admission or
 * after the discharge is not a correction, it is a line on the wrong patient's
 * bill - and on a claim it is the first date a TPA matches to the case sheet.
 *
 * Every instant here is written WITHOUT a trailing Z, so it parses as the
 * machine's own wall clock. The rule is about a ward's day, and the printed
 * dates it is checked against are local ones - a test pinned to UTC would pass
 * in one timezone and print the wrong day in another.
 */

/** Local wall clock, like `bill-date.test.ts` - never a UTC instant. */
const at = (s: string) => new Date(s);
const stay = { admittedAt: at("2026-08-10T09:30:00"), dischargedAt: at("2026-08-14T11:30:00") };
/** Still in a bed - the ceiling is `now`, not a discharge that has not happened. */
const openStay = { admittedAt: at("2026-08-10T09:30:00"), dischargedAt: null };
const now = at("2026-08-15T14:00:00");

describe("re-dating a charge on the running tab", () => {
  it("leaves the column alone when no date was sent", () => {
    // A repricing that never touched the date must not move it a second either.
    expect(resolveChargeDate(undefined, stay, now)).toBeUndefined();
  });

  it("keeps the instant exactly, time included", () => {
    // The tab sorts by this and prints the clock time - two doctor rounds on one
    // day are told apart by nothing else.
    const d = resolveChargeDate("2026-08-11T09:15:00", stay, now)!;
    expect(d.getTime()).toBe(at("2026-08-11T09:15:00").getTime());
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(15);
  });

  it("refuses a date before the patient was admitted", () => {
    expect(() => resolveChargeDate("2026-08-10T08:00:00", stay, now)).toThrow(ChargeDateError);
  });

  it("allows the admission moment itself", () => {
    // The admission-day procedure. An exclusive bound would refuse it.
    const d = resolveChargeDate("2026-08-10T09:30:00", stay, now)!;
    expect(d.getTime()).toBe(stay.admittedAt.getTime());
  });

  it("refuses a date after the patient left", () => {
    expect(() => resolveChargeDate("2026-08-14T12:30:00", stay, now)).toThrow(ChargeDateError);
  });

  it("says which dates the desk is arguing with", () => {
    // The refusal is read at a counter with a family waiting. It has to carry
    // the date to compare against, not just "invalid".
    expect(() => resolveChargeDate("2026-08-10T08:00:00", stay, now)).toThrow(/admitted on 10-08-2026, 9:30 AM/);
    expect(() => resolveChargeDate("2026-08-14T12:30:00", stay, now)).toThrow(/discharged on 14-08-2026, 11:30 AM/);
  });

  it("never accepts the future - unlike a bill date", () => {
    // A bill may be dated tomorrow by a clock a day out; a treatment cannot have
    // happened yet. Only clock skew between the desk and the server is forgiven.
    expect(() => resolveChargeDate("2026-08-15T14:30:00", openStay, now)).toThrow(ChargeDateError);
    const skewed = resolveChargeDate("2026-08-15T14:03:00", openStay, now)!;
    expect(skewed.getTime()).toBe(at("2026-08-15T14:03:00").getTime());
  });

  it("lets an open stay be dated up to now", () => {
    const d = resolveChargeDate("2026-08-15T13:59:00", openStay, now)!;
    expect(d.getTime()).toBe(at("2026-08-15T13:59:00").getTime());
  });

  it("refuses something that is not a date at all", () => {
    expect(() => resolveChargeDate("yesterday morning", stay, now)).toThrow(ChargeDateError);
  });
});
