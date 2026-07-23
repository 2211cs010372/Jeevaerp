import { describe, it, expect } from "vitest";
import { localDateISO, dateOnlyISO, startOfLocalDay, addDays, parseLocalDate } from "@/lib/date";

/**
 * The bug these pin down: `new Date().toISOString().slice(0,10)` is UTC, so in
 * a +offset clinic (IST is +5:30) it returns YESTERDAY between 00:00 and 05:30.
 * That put the wrong date on a day-close report and made "today's" queue show
 * the previous day's list at 2 AM.
 *
 * There are two kinds of date here and they extract differently:
 *   - `@db.Date` columns come back as UTC midnight of their calendar day -> dateOnlyISO
 *   - timestamps are real instants -> localDateISO (the clinic's day)
 */

describe("localDateISO - the clinic's calendar day", () => {
  it("reads LOCAL components, so early-morning is still today", () => {
    // 2 AM on 23 July, local wall clock. In IST this instant is 22 July in UTC.
    const earlyMorning = new Date(2026, 6, 23, 2, 0, 0);
    expect(localDateISO(earlyMorning)).toBe("2026-07-23");
  });

  it("holds at both ends of the day", () => {
    expect(localDateISO(new Date(2026, 6, 23, 0, 0, 0))).toBe("2026-07-23");
    expect(localDateISO(new Date(2026, 6, 23, 23, 59, 59))).toBe("2026-07-23");
  });

  it("zero-pads month and day", () => {
    expect(localDateISO(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("never disagrees with the local calendar, whatever the runtime zone", () => {
    // The contract, stated so it holds in any timezone the server runs in.
    for (const d of [new Date(2026, 6, 23, 0, 30), new Date(2026, 11, 31, 23, 30), new Date(2026, 2, 1, 5, 0)]) {
      const [y, m, day] = localDateISO(d).split("-").map(Number);
      expect([y, m, day]).toEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()]);
    }
  });
});

describe("dateOnlyISO - values from @db.Date columns", () => {
  it("returns the stored calendar day", () => {
    // Prisma hands back a date-only column as UTC midnight of that day.
    expect(dateOnlyISO(new Date("2026-07-23T00:00:00.000Z"))).toBe("2026-07-23");
  });

  it("is stable regardless of the server's offset", () => {
    expect(dateOnlyISO(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01-01");
  });
});

describe("startOfLocalDay / addDays", () => {
  it("startOfLocalDay zeroes the clock without moving the day", () => {
    const s = startOfLocalDay(new Date(2026, 6, 23, 17, 34, 39));
    expect(localDateISO(s)).toBe("2026-07-23");
    expect([s.getHours(), s.getMinutes(), s.getSeconds(), s.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it("addDays does not mutate its input", () => {
    const base = new Date(2026, 6, 23, 9, 0, 0);
    const later = addDays(base, 5);
    expect(localDateISO(later)).toBe("2026-07-28");
    expect(localDateISO(base)).toBe("2026-07-23");
  });

  it("crosses month and year boundaries", () => {
    expect(localDateISO(addDays(new Date(2026, 6, 30, 9, 0), 3))).toBe("2026-08-02");
    expect(localDateISO(addDays(new Date(2026, 11, 30, 9, 0), 3))).toBe("2027-01-02");
  });
});

describe("parseLocalDate", () => {
  it("round-trips with localDateISO", () => {
    for (const s of ["2026-07-23", "2026-01-01", "2026-12-31"]) {
      expect(localDateISO(parseLocalDate(s))).toBe(s);
    }
  });

  it("lands on local midnight, not UTC midnight", () => {
    const d = parseLocalDate("2026-07-23");
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
    expect(d.getDate()).toBe(23);
  });
});
