import { describe, it, expect } from "vitest";
import { agePayload, ageFromDob, ageInRange, ageParts, dobFromAge, ageYears, formatAge } from "@/lib/age";

/**
 * The bug this pins down: a lab counter that can only take a number of YEARS
 * files an eleven-day-old newborn and an eleven-month-old infant under the same
 * answer - 0 - and the report then reads their bilirubin and haemoglobin
 * against a range neither of them belongs to.
 *
 * Local wall-clock components throughout, never `toISOString()`, for the same
 * reason lib/date exists: in IST that returns yesterday before 05:30.
 */

const AUG_27 = new Date(2026, 7, 27, 10, 0, 0); // Thursday 27 August 2026, IST

describe("dobFromAge - the date behind 'N units old'", () => {
  it("counts days back across a month boundary", () => {
    expect(dobFromAge(11, "D", AUG_27)).toBe("2026-08-16");
    expect(dobFromAge(30, "D", AUG_27)).toBe("2026-07-28");
    expect(dobFromAge(0, "D", AUG_27)).toBe("2026-08-27"); // born today
  });

  it("counts months back, and years back", () => {
    expect(dobFromAge(5, "M", AUG_27)).toBe("2026-03-27");
    expect(dobFromAge(9, "M", AUG_27)).toBe("2025-11-27");
    expect(dobFromAge(34, "Y", AUG_27)).toBe("1992-08-27");
  });

  it("CLAMPS the day instead of rolling over", () => {
    // One month before 31 March is the last day of February - not 3 March,
    // which is where setMonth() alone lands.
    const mar31 = new Date(2026, 2, 31, 9, 0, 0);
    expect(dobFromAge(1, "M", mar31)).toBe("2026-02-28");
    // ...and February has 29 days in a leap year.
    const mar31Leap = new Date(2028, 2, 31, 9, 0, 0);
    expect(dobFromAge(1, "M", mar31Leap)).toBe("2028-02-29");
    // 29 February minus one year is 28 February.
    const feb29 = new Date(2028, 1, 29, 9, 0, 0);
    expect(dobFromAge(1, "Y", feb29)).toBe("2027-02-28");
  });
});

describe("ageYears - what the `age` column holds", () => {
  it("rounds months and days DOWN to completed years", () => {
    expect(ageYears(34, "Y")).toBe(34);
    expect(ageYears(11, "M")).toBe(0);
    expect(ageYears(18, "M")).toBe(1);
    expect(ageYears(11, "D")).toBe(0);
    expect(ageYears(400, "D")).toBe(1);
  });
});

describe("agePayload - which columns a typed age writes", () => {
  it("writes NO dob for years - we were told an age, not a birthday", () => {
    expect(agePayload(34, "Y", AUG_27)).toEqual({ age: 34 });
  });

  it("writes a dob for months and days, where `age` alone loses the answer", () => {
    expect(agePayload(5, "M", AUG_27)).toEqual({ age: 0, dob: "2026-03-27" });
    expect(agePayload(11, "D", AUG_27)).toEqual({ age: 0, dob: "2026-08-16" });
  });
});

describe("ageInRange - the guard on a nonsense date of birth", () => {
  it("takes what a counter plausibly types", () => {
    expect(ageInRange(0, "D")).toBe(true);
    expect(ageInRange(400, "D")).toBe(true); // a 13-month-old, said in days
    expect(ageInRange(18, "M")).toBe(true);
    expect(ageInRange(120, "Y")).toBe(true);
  });

  it("refuses what could only be a slip", () => {
    expect(ageInRange(121, "Y")).toBe(false);
    expect(ageInRange(401, "D")).toBe(false);
    expect(ageInRange(241, "M")).toBe(false);
    expect(ageInRange(-1, "M")).toBe(false);
    expect(ageInRange(1.5, "Y")).toBe(false);
  });
});

describe("formatAge - the unit a paediatrician would say out loud", () => {
  const at = (dob: string) => formatAge({ age: 0, dob }, {}, AUG_27);

  it("days under a month, months under two years, years after", () => {
    expect(at("2026-08-16")).toBe("11d");
    expect(at("2026-08-27")).toBe("0d");
    expect(at("2026-03-27")).toBe("5m");
    expect(at("2025-08-27")).toBe("12m");
    expect(at("2024-08-27")).toBe("2y");
    expect(formatAge({ age: 34, dob: "1992-08-27" }, {}, AUG_27)).toBe("34y");
  });

  it("spells the unit out for the printed report", () => {
    expect(formatAge({ age: 0, dob: "2026-08-16" }, { long: true }, AUG_27)).toBe("11 days");
    expect(formatAge({ age: 0, dob: "2026-08-26" }, { long: true }, AUG_27)).toBe("1 day");
    expect(formatAge({ age: 0, dob: "2026-03-27" }, { long: true }, AUG_27)).toBe("5 months");
    expect(formatAge({ age: 34 }, { long: true }, AUG_27)).toBe("34 years");
  });

  it("falls back to the years column for everyone registered before this form", () => {
    expect(formatAge({ age: 34, dob: null }, {}, AUG_27)).toBe("34y");
    // 0 with no dob is an adult's answer to a question nobody refined - it is
    // still printed, because it is what the record says.
    expect(formatAge({ age: 0, dob: null }, {}, AUG_27)).toBe("0y");
  });

  it("gives null - not '0' - when nobody ever asked", () => {
    expect(formatAge({ age: null, dob: null }, {}, AUG_27)).toBeNull();
    expect(formatAge(null, {}, AUG_27)).toBeNull();
  });
});

describe("ageParts - a dob read back the way it was typed", () => {
  it("round-trips every unit", () => {
    expect(ageParts(dobFromAge(11, "D", AUG_27), AUG_27).days).toBe(11);
    expect(ageParts(dobFromAge(5, "M", AUG_27), AUG_27).months).toBe(5);
    expect(ageParts(dobFromAge(34, "Y", AUG_27), AUG_27).years).toBe(34);
  });

  it("does not credit a birthday that has not happened yet", () => {
    // Born 28 August 2000, read on 27 August 2026 - still 25.
    expect(ageParts("2000-08-28", AUG_27).years).toBe(25);
    expect(ageParts("2000-08-27", AUG_27).years).toBe(26);
  });
});

describe("ageFromDob - the box the registration form fills from a picked date", () => {
  it("hands back the number AND the unit it would be said in", () => {
    expect(ageFromDob("2026-08-16", AUG_27)).toEqual({ value: 11, unit: "D" });
    expect(ageFromDob("2026-08-27", AUG_27)).toEqual({ value: 0, unit: "D" });
    expect(ageFromDob("2026-03-27", AUG_27)).toEqual({ value: 5, unit: "M" });
    expect(ageFromDob("2025-08-27", AUG_27)).toEqual({ value: 12, unit: "M" });
    expect(ageFromDob("2024-08-27", AUG_27)).toEqual({ value: 2, unit: "Y" });
    expect(ageFromDob("1992-08-27", AUG_27)).toEqual({ value: 34, unit: "Y" });
  });

  it("round-trips a typed infant age back to the same number and unit", () => {
    for (const [value, unit] of [[11, "D"], [29, "D"], [5, "M"], [18, "M"]] as const) {
      expect(ageFromDob(dobFromAge(value, unit, AUG_27), AUG_27)).toEqual({ value, unit });
    }
  });

  it("agrees with what formatAge prints - one rule, not two", () => {
    for (const dob of ["2026-08-16", "2026-03-27", "2025-08-27", "1992-08-27"]) {
      const { value, unit } = ageFromDob(dob, AUG_27);
      const short = { Y: "y", M: "m", D: "d" }[unit];
      expect(formatAge({ age: 0, dob }, {}, AUG_27)).toBe(`${value}${short}`);
    }
  });
});
