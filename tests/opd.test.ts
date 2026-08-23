import { describe, it, expect } from "vitest";
import {
  BOARD_START, BOARD_END,
  allowedDays, boardPct, clockLabel, dailyHours, daysInWords,
  hhmm, nextConsultingDate, opdSheetDate, opdWindow, slotsFor,
} from "@/lib/opd";

/**
 * These numbers are printed on the OPD board, drawn as the band, AND used to
 * build the slot grid. If they drift, the website offers a patient a time the
 * booking form will then refuse - so they are pinned here.
 */

describe("reading a doctor's OPD window", () => {
  it("parses the printed window", () => {
    expect(opdWindow("9:00 – 13:00")).toEqual({ start: 540, end: 780 });
  });

  it("accepts a plain hyphen as well as an en dash", () => {
    expect(opdWindow("10:00 - 14:00")).toEqual({ start: 600, end: 840 });
  });

  it("refuses a window that ends before it starts", () => {
    // Better no band at all than a band drawn backwards.
    expect(opdWindow("14:00 – 10:00")).toBeNull();
  });

  it("returns null rather than guessing at nonsense", () => {
    expect(opdWindow("mornings")).toBeNull();
  });
});

describe("slots - what the patient can actually pick", () => {
  it("cuts the window into 30-minute slots", () => {
    expect(slotsFor("9:00 – 13:00")).toEqual([
      "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
    ]);
  });

  it("never offers the closing time itself", () => {
    // 13:00 is when they stop, not a slot you can book.
    expect(slotsFor("9:00 – 13:00")).not.toContain("13:00");
  });

  it("covers a full-day clinic", () => {
    expect(slotsFor("8:00 – 20:00")).toHaveLength(24);
  });

  it("is empty when the window can't be read", () => {
    expect(slotsFor("by appointment")).toEqual([]);
  });
});

describe("consulting days", () => {
  it("expands a range", () => {
    expect([...allowedDays("Mon–Sat")].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("understands Daily", () => {
    expect(allowedDays("Daily").size).toBe(7);
  });

  it("handles a mid-week range", () => {
    expect([...allowedDays("Tue–Sat")].sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it("falls back to Mon-Sat rather than locking a doctor out entirely", () => {
    expect([...allowedDays("whenever")].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("the next date a patient can actually be seen", () => {
  it("keeps today when the doctor sits today", () => {
    // 2026-07-28 is a Tuesday.
    const tue = new Date("2026-07-28T09:00:00");
    expect(nextConsultingDate("Mon–Sat", tue)).toBe("2026-07-28");
  });

  it("skips forward off a day they don't consult", () => {
    // 2026-07-26 is a Sunday; a Mon-Sat doctor is next in on the Monday.
    const sun = new Date("2026-07-26T09:00:00");
    expect(nextConsultingDate("Mon–Sat", sun)).toBe("2026-07-27");
  });

  it("skips a Sunday AND a Monday for a Tue-Sat doctor", () => {
    const sun = new Date("2026-07-26T09:00:00");
    expect(nextConsultingDate("Tue–Sat", sun)).toBe("2026-07-28");
  });

  it("always lands on a day the doctor is in", () => {
    // The profile page hands this date to the booking form, which validates
    // against the same rule - so a mismatch here is a dead-end for the patient.
    for (const days of ["Mon–Sat", "Tue–Sat", "Mon–Fri", "Daily"]) {
      for (let i = 0; i < 7; i++) {
        const from = new Date(2026, 6, 26 + i, 9);
        const iso = nextConsultingDate(days, from);
        const landed = new Date(`${iso}T00:00:00`).getDay();
        expect(allowedDays(days).has(landed)).toBe(true);
      }
    }
  });
});

describe("the board scale", () => {
  it("pins the ends of the hospital's OPD day", () => {
    expect(boardPct(BOARD_START)).toBe(0);
    expect(boardPct(BOARD_END)).toBe(100);
  });

  it("puts 2 PM three quarters of the way across an 8-to-8 day", () => {
    expect(boardPct(14 * 60)).toBe(50);
  });

  it("clamps anything outside the board instead of overflowing the bar", () => {
    expect(boardPct(6 * 60)).toBe(0);
    expect(boardPct(23 * 60)).toBe(100);
  });
});

describe("labels a patient reads", () => {
  it("writes the clock the way people say it", () => {
    expect(clockLabel(9 * 60)).toBe("9 AM");
    expect(clockLabel(13 * 60)).toBe("1 PM");
    expect(clockLabel(12 * 60)).toBe("12 PM");
    expect(clockLabel(11 * 60 + 30)).toBe("11:30 AM");
  });

  it("writes days out in full", () => {
    expect(daysInWords("Mon–Sat")).toBe("Monday to Saturday");
    expect(daysInWords("Daily")).toBe("Every day");
  });

  it("pads the machine format", () => {
    expect(hhmm(9 * 60)).toBe("09:00");
    expect(hhmm(14 * 60 + 30)).toBe("14:30");
  });
});

describe("hours at the desk", () => {
  it("measures the window", () => {
    expect(dailyHours("9:00 – 13:00")).toBe(4);
    expect(dailyHours("8:00 – 20:00")).toBe(12);
    expect(dailyHours("11:00 – 16:00")).toBe(5);
  });

  it("counts round-the-clock cover as a full day", () => {
    // "Open 24 Hours" has no parseable window, and falling through to 0 printed
    // "0 hrs/day" against the doctors who are there the most.
    expect(dailyHours("Open 24 Hours")).toBe(24);
    expect(dailyHours("open 24 hrs")).toBe(24);
  });

  it("is zero when there's no window to measure", () => {
    expect(dailyHours("on call")).toBe(0);
    expect(dailyHours("By Appointment")).toBe(0);
  });
});

/*
 * Availability is deliberately NOT tested here any more. It is no longer
 * computed - it comes from the DoctorSlot table via /api/v1/public/slots, and
 * the guarantee that matters (two people can't take the same slot) is the
 * atomic claim in public-booking.service, not arithmetic.
 */

/**
 * THE DATE THE CASE SHEET PRINTS.
 *
 * The desk can re-date a sheet because entry lags the consultation: an OP is
 * booked this morning for a patient who was actually seen yesterday, and the
 * paper has to say yesterday. What must NOT happen is that fix reaching
 * visitDate - that column is today's queue, today's counts and today's
 * day-close, and moving it to please one printout moves the patient too.
 *
 * So: `printed` is what goes on the paper, `record` is what the appointment
 * still says, and `reDated` is the flag the screen warns on. These are pinned
 * because the day they quietly agree is the day a backdated sheet prints with
 * nothing on screen saying so.
 */
describe("the date an OPD case sheet prints", () => {
  const today = "2026-08-23";

  it("prints the visit's own date when nobody overrides it", () => {
    const d = opdSheetDate("2026-08-23", null, { today });
    expect(d.printed).toBe("2026-08-23");
    expect(d.record).toBe("2026-08-23");
    expect(d.reDated).toBe(false);
  });

  it("prints yesterday when the desk asks for yesterday", () => {
    const d = opdSheetDate("2026-08-23", "2026-08-22", { today });
    expect(d.printed).toBe("2026-08-22");
    expect(d.reDated).toBe(true);
  });

  it("leaves the record alone - the override never becomes the visit date", () => {
    const d = opdSheetDate("2026-08-23", "2026-08-22", { today });
    expect(d.record).toBe("2026-08-23");
  });

  it("dates a headed blank pad today, and re-dates it on request", () => {
    expect(opdSheetDate(null, null, { headed: true, today }).printed).toBe(today);
    const d = opdSheetDate(null, "2026-08-20", { headed: true, today });
    expect(d.printed).toBe("2026-08-20");
    expect(d.reDated).toBe(true);
  });

  it("leaves a plain pad's date line empty for the pen", () => {
    const d = opdSheetDate(null, null, { today });
    expect(d.printed).toBe("");
    expect(d.reDated).toBe(false);
  });

  it("still warns nothing when the desk re-types the date it already had", () => {
    expect(opdSheetDate("2026-08-23", "2026-08-23", { today }).reDated).toBe(false);
  });

  it("lets the desk type back as far as it likes but no further than today", () => {
    expect(opdSheetDate("2026-08-23", null, { today }).latest).toBe(today);
  });

  it("allows a visit booked for next week to print its own future date", () => {
    expect(opdSheetDate("2026-08-30", null, { today }).latest).toBe("2026-08-30");
  });
});
