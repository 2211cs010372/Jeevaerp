import { describe, it, expect } from "vitest";
import { callbackOtpSchema, callbackRequestSchema, updateCallbackRequestSchema } from "@/server/validators/public-booking";

/**
 * This is the only unauthenticated endpoint that writes to the reception queue.
 * Everything the desk will act on passes through these schemas first, so the
 * boundary is pinned here: what is required, what is optional, and what is
 * refused outright.
 */

const ok = { name: "Ramesh Kumar", phone: "9848012345", code: "123456" };
const parse = (o: Record<string, unknown>) => callbackRequestSchema.safeParse({ ...ok, ...o });

describe("asking for a code", () => {
  it("needs only the number", () => {
    expect(callbackOtpSchema.safeParse({ phone: "9848012345" }).success).toBe(true);
  });

  it("accepts any shape and stores it with the country code", () => {
    // Numbers are STORED in E.164 (+919848012345) - see lib/phone.ts. The
    // validator is where that canonical form is produced, so whatever a web
    // form sends, one value reaches the database.
    for (const shape of ["+91 98480 12345", "9848012345", "919848012345", "09848012345"]) {
      const r = callbackOtpSchema.safeParse({ phone: shape });
      expect(r.success, shape).toBe(true);
      if (r.success) expect(r.data.phone, shape).toBe("+919848012345");
    }
  });

  it("refuses a number that isn't an Indian mobile", () => {
    // Indian mobiles start 6-9. A landline or a typo must not burn an SMS.
    expect(callbackOtpSchema.safeParse({ phone: "1234567890" }).success).toBe(false);
    expect(callbackOtpSchema.safeParse({ phone: "98480" }).success).toBe(false);
  });
});

describe("what the desk is allowed to receive", () => {
  it("accepts the minimum: name, verified number, code", () => {
    expect(parse({}).success).toBe(true);
  });

  it("treats the doctor as optional - 'any available' is a real answer", () => {
    expect(parse({ doctorId: "" }).success).toBe(true);
    expect(parse({ doctorId: "d1" }).success).toBe(true);
  });

  it("keeps the preferred day optional but well-formed when given", () => {
    expect(parse({ preferredDate: "" }).success).toBe(true);
    expect(parse({ preferredDate: "2026-08-01" }).success).toBe(true);
    expect(parse({ preferredDate: "01-08-2026" }).success).toBe(false);
  });

  it("refuses a name that isn't one - this becomes a medical record", () => {
    expect(parse({ name: "A" }).success).toBe(false);
    expect(parse({ name: "<script>alert(1)</script>" }).success).toBe(false);
    expect(parse({ name: "9848012345" }).success).toBe(false);
  });

  it("requires exactly six digits for the code", () => {
    for (const code of ["12345", "1234567", "12345a", ""]) {
      expect(parse({ code }).success, `code ${code} must be refused`).toBe(false);
    }
  });

  it("caps the free-text note rather than letting it run", () => {
    expect(parse({ note: "x".repeat(500) }).success).toBe(true);
    expect(parse({ note: "x".repeat(501) }).success).toBe(false);
  });

  it("normalises the phone to the stored E.164 form", () => {
    const r = parse({ phone: "+91-98480-12345" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("+919848012345");
  });
});

describe("the desk moving a request along", () => {
  it("accepts the four real states", () => {
    for (const status of ["NEW", "CONTACTED", "BOOKED", "CLOSED"]) {
      expect(updateCallbackRequestSchema.safeParse({ status }).success).toBe(true);
    }
  });

  it("refuses a state that doesn't exist", () => {
    expect(updateCallbackRequestSchema.safeParse({ status: "PENDING" }).success).toBe(false);
  });

  it("carries an appointment id when booking closes the loop", () => {
    const r = updateCallbackRequestSchema.safeParse({ status: "BOOKED", appointmentId: "appt_1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.appointmentId).toBe("appt_1");
  });
});
