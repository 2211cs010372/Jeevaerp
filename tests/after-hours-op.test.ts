import { describe, it, expect } from "vitest";
import {
  isAfterHours, minutesOfDay, opFeeFor, prettyTime, type AfterHoursPolicy,
} from "@/lib/after-hours";

/**
 * The evening cutoff decides what a patient pays, so the boundary minutes are
 * the whole test. The window normally crosses midnight (20:00 → 06:00), which is
 * the case a start <= t < end comparison gets silently wrong: it reads false all
 * night, and the 2 AM emergency - the one visit nobody should be charging a day
 * fee for - goes out at the day fee.
 */

const policy: AfterHoursPolicy = { enabled: true, start: "20:00", end: "06:00", multiplier: 2 };

describe("when a visit counts as after hours", () => {
  it("charges the day fee during the clinic day", () => {
    for (const t of ["09:00", "13:30", "17:45", "19:59"]) {
      expect(isAfterHours(t, policy)).toBe(false);
    }
  });

  it("starts exactly on the cutoff minute", () => {
    expect(isAfterHours("19:59", policy)).toBe(false);
    expect(isAfterHours("20:00", policy)).toBe(true);
  });

  it("carries on through midnight", () => {
    for (const t of ["21:30", "23:59", "00:00", "02:00", "05:59"]) {
      expect(isAfterHours(t, policy)).toBe(true);
    }
  });

  it("ends on the morning boundary, which is exclusive", () => {
    expect(isAfterHours("05:59", policy)).toBe(true);
    expect(isAfterHours("06:00", policy)).toBe(false);
  });

  it("handles a same-day window that doesn't cross midnight", () => {
    const evening: AfterHoursPolicy = { ...policy, start: "20:00", end: "23:59" };
    expect(isAfterHours("21:00", evening)).toBe(true);
    expect(isAfterHours("02:00", evening)).toBe(false);
    expect(isAfterHours("19:00", evening)).toBe(false);
  });

  it("does nothing at all when switched off", () => {
    expect(isAfterHours("02:00", { ...policy, enabled: false })).toBe(false);
  });

  it("treats a zero-length window as never, not always", () => {
    expect(isAfterHours("20:00", { ...policy, start: "20:00", end: "20:00" })).toBe(false);
  });

  it("fails open on the cheaper fee when the window is malformed", () => {
    // A bad setting must never silently double what a patient is charged.
    expect(isAfterHours("22:00", { ...policy, start: "" })).toBe(false);
    expect(isAfterHours("22:00", { ...policy, start: "8pm" })).toBe(false);
    expect(isAfterHours("22:00", { ...policy, end: "26:00" })).toBe(false);
    expect(isAfterHours("nonsense", policy)).toBe(false);
  });
});

describe("what the visit costs", () => {
  it("doubles the day fee after the cutoff", () => {
    expect(opFeeFor(600, "21:00", policy)).toEqual({ fee: 1200, afterHours: true });
  });

  it("leaves a daytime visit at the day fee", () => {
    expect(opFeeFor(600, "11:00", policy)).toEqual({ fee: 600, afterHours: false });
  });

  it("scales each doctor's own fee rather than a shared flat figure", () => {
    // The whole reason the policy stores a multiplier: ₹500 and ₹900 must both
    // become double, not both become one number.
    expect(opFeeFor(500, "22:00", policy).fee).toBe(1000);
    expect(opFeeFor(900, "22:00", policy).fee).toBe(1800);
  });

  it("rounds to whole rupees so the bill matches the cash drawer", () => {
    expect(opFeeFor(650, "22:00", { ...policy, multiplier: 1.5 }).fee).toBe(975);
    expect(opFeeFor(655, "22:00", { ...policy, multiplier: 1.5 }).fee).toBe(983);
  });

  it("never discounts the day fee, whatever the multiplier says", () => {
    expect(opFeeFor(600, "22:00", { ...policy, multiplier: 0.5 })).toEqual({ fee: 600, afterHours: false });
    expect(opFeeFor(600, "22:00", { ...policy, multiplier: 1 })).toEqual({ fee: 600, afterHours: false });
  });

  it("leaves a ₹0 visit at ₹0 - doubling nothing is still nothing", () => {
    // Casualty with no doctor named: charges are raised afterwards, per procedure.
    expect(opFeeFor(0, "22:00", policy)).toEqual({ fee: 0, afterHours: false });
  });
});

describe("what the booking screen sends", () => {
  // The desk's override travels as `feeOverride` on the booking payload, and the
  // service uses it in place of the policy figure. ₹0 has to survive the trip:
  // a waived fee is a real decision, and a schema that dropped it would silently
  // charge the patient the full night rate instead.
  it("accepts a typed fee, including a waiver", async () => {
    const { bookAppointmentSchema } = await import("@/server/validators/reception");
    const base = { patientId: "pat_1", type: "EMERGENCY" as const };

    const waived = bookAppointmentSchema.safeParse({ ...base, feeOverride: 0 });
    expect(waived.success).toBe(true);
    if (waived.success) expect(waived.data.feeOverride).toBe(0);

    const agreed = bookAppointmentSchema.safeParse({ ...base, feeOverride: 800 });
    expect(agreed.success && agreed.data.feeOverride).toBe(800);
  });

  it("leaves feeOverride absent when the desk didn't touch the amount", async () => {
    const { bookAppointmentSchema } = await import("@/server/validators/reception");
    const r = bookAppointmentSchema.safeParse({ patientId: "pat_1", type: "EMERGENCY" });
    expect(r.success && r.data.feeOverride).toBeUndefined();
  });

  it("refuses a negative fee or an absurd one", async () => {
    const { bookAppointmentSchema } = await import("@/server/validators/reception");
    const base = { patientId: "pat_1", type: "EMERGENCY" as const };
    expect(bookAppointmentSchema.safeParse({ ...base, feeOverride: -1 }).success).toBe(false);
    expect(bookAppointmentSchema.safeParse({ ...base, feeOverride: 100001 }).success).toBe(false);
  });
});

describe("what the admin settings screen accepts", () => {
  const base = {
    legalName: "Jeeva Multispeciality Hospital", addressLine: "1 Main Road",
    city: "Hyderabad", state: "Telangana", stateCode: "36", pincode: "500001",
  };

  it("takes a window that crosses midnight", async () => {
    const { hospitalConfigSchema } = await import("@/server/validators/admin");
    const r = hospitalConfigSchema.safeParse({
      ...base, afterHoursOpStart: "20:00", afterHoursOpEnd: "06:00", afterHoursOpMultiplier: 2,
    });
    expect(r.success).toBe(true);
  });

  it("refuses a time that isn't a time", async () => {
    const { hospitalConfigSchema } = await import("@/server/validators/admin");
    for (const bad of ["8pm", "24:00", "20:60", "2000", ""]) {
      expect(hospitalConfigSchema.safeParse({ ...base, afterHoursOpStart: bad }).success).toBe(false);
    }
  });

  it("refuses a multiplier that would discount the night shift", async () => {
    const { hospitalConfigSchema } = await import("@/server/validators/admin");
    expect(hospitalConfigSchema.safeParse({ ...base, afterHoursOpMultiplier: 0.5 }).success).toBe(false);
    expect(hospitalConfigSchema.safeParse({ ...base, afterHoursOpMultiplier: 1 }).success).toBe(true);
  });
});

describe("reading the clock", () => {
  it("parses HH:MM to minutes", () => {
    expect(minutesOfDay("00:00")).toBe(0);
    expect(minutesOfDay("20:00")).toBe(1200);
    expect(minutesOfDay("23:59")).toBe(1439);
    expect(minutesOfDay("9:05")).toBe(545);
  });

  it("rejects what isn't a time", () => {
    for (const bad of ["", "24:00", "20:60", "8pm", "2000", "20:0"]) {
      expect(minutesOfDay(bad)).toBeNull();
    }
  });

  it("says the cutoff the way the desk would read it", () => {
    expect(prettyTime("20:00")).toBe("8:00 PM");
    expect(prettyTime("06:00")).toBe("6:00 AM");
    expect(prettyTime("00:30")).toBe("12:30 AM");
    expect(prettyTime("12:00")).toBe("12:00 PM");
  });
});
