import { describe, it, expect } from "vitest";
import { bookAppointmentSchema } from "@/server/validators/reception";

/**
 * Casualty is the ONE flow allowed to book a visit with no slot. That exception
 * is the whole risk: loosen it by one type and every walk-in can be saved with
 * no doctor, no time, and no place on anyone's list. These pin the boundary.
 */

const base = { patientId: "pat_1" };
const parse = (input: Record<string, unknown>) => bookAppointmentSchema.safeParse({ ...base, ...input });

describe("who may book without a slot", () => {
  it("lets an emergency through with nothing but a patient", () => {
    const r = parse({ type: "EMERGENCY" });
    expect(r.success).toBe(true);
  });

  it("lets casualty through the same way", () => {
    expect(parse({ type: "CASUALTY" }).success).toBe(true);
  });

  it("refuses a walk-in with no slot", () => {
    const r = parse({ type: "WALKIN" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["slotId"]);
  });

  it("refuses an online booking with no slot", () => {
    expect(parse({ type: "ONLINE" }).success).toBe(false);
  });

  it("refuses a walk-in whose slot is blank rather than absent", () => {
    // The book form sends "" for an untouched field; that is not a slot.
    expect(parse({ type: "WALKIN", slotId: "   " }).success).toBe(false);
  });

  it("defaults to WALKIN, and so still demands a slot", () => {
    // Type is optional. If omitting it fell back to the permissive branch, the
    // whole rule could be skipped by simply not sending a type.
    expect(parse({}).success).toBe(false);
    expect(parse({ slotId: "slot_1" }).success).toBe(true);
  });
});

describe("what an emergency booking may still carry", () => {
  it("accepts a named doctor - a consultant who already took the case", () => {
    const r = parse({ type: "EMERGENCY", doctorId: "doc_1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.doctorId).toBe("doc_1");
  });

  it("keeps the referral snapshot", () => {
    const r = parse({ type: "EMERGENCY", referredByName: "Dr. Anil", referralSource: "Ambulance" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.referredByName).toBe("Dr. Anil");
  });

  it("still requires a patient", () => {
    const r = bookAppointmentSchema.safeParse({ type: "EMERGENCY" });
    expect(r.success).toBe(false);
  });

  it("rejects a visit type that isn't one of the four", () => {
    expect(parse({ type: "URGENT" }).success).toBe(false);
  });
});
