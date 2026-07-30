import { describe, it, expect } from "vitest";
import { scrub, normalizeRoute, fingerprint } from "@/server/services/errors.service";

/**
 * The scrubbing and grouping rules are the whole trustworthiness of the error
 * table. If scrub() leaks, every crash becomes a small disclosure of patient
 * data and the admin viewer becomes the least protected copy of the UHID index.
 * If fingerprint() is unstable, one defect files a thousand rows and the table
 * gets ignored, which is the same as not having it.
 */

describe("scrub - patient identifiers never reach storage", () => {
  it("redacts a UHID in the OP format", () => {
    expect(scrub("No patient found for JMH2026OP00123")).toBe("No patient found for [uhid]");
  });

  it("redacts a UHID in the IP format", () => {
    expect(scrub("Admission JMH2026IP00007 already closed")).toBe("Admission [uhid] already closed");
  });

  it("redacts a bare 10-digit mobile", () => {
    expect(scrub("Unique constraint failed on phone 9704691308")).toBe(
      "Unique constraint failed on phone [phone]",
    );
  });

  it("redacts a mobile written with +91 and spacing", () => {
    expect(scrub("dup: +91 9704691308")).toBe("dup: [phone]");
  });

  it("redacts an email address", () => {
    expect(scrub("cannot mail nagaruthwik@example.com")).toBe("cannot mail [email]");
  });

  it("redacts a JWT that an error printed back", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-123_XYZ";
    expect(scrub(`bad token ${jwt}`)).toBe("bad token [jwt]");
  });

  it("keeps a UHID recognizable rather than letting the phone rule eat its tail", () => {
    // Ordering regression: the phone rule matches 10 digit runs, and a naive
    // order turned JMH2026OP00123 into JMH[phone], which reads as neither.
    expect(scrub("JMH2026OP00123")).toBe("[uhid]");
  });

  it("leaves ordinary technical text alone", () => {
    const msg = "Cannot read properties of undefined (reading 'medicineName')";
    expect(scrub(msg)).toBe(msg);
  });

  it("redacts every occurrence, not just the first", () => {
    expect(scrub("JMH2026OP00001 and JMH2026OP00002")).toBe("[uhid] and [uhid]");
  });

  it("passes an empty string through", () => {
    expect(scrub("")).toBe("");
  });
});

describe("normalizeRoute - a stored route carries no identifiers", () => {
  const cases: [string, string][] = [
    ["/api/v1/reception/patients/JMH2026OP00123", "/api/v1/reception/patients/:id"],
    ["/api/v1/ipd/admissions/ckq3x8h2k0000qzrmn831i7rn/charges", "/api/v1/ipd/admissions/:id/charges"],
    ["/api/v1/billing/invoices/42", "/api/v1/billing/invoices/:id"],
    [
      "/api/v1/labs/orders/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      "/api/v1/labs/orders/:id",
    ],
    // No identifier to strip: must survive untouched
    ["/api/v1/reception/doctors", "/api/v1/reception/doctors"],
    ["/api/v1/auth/staff/login", "/api/v1/auth/staff/login"],
    ["/", "/"],
  ];
  for (const [raw, want] of cases) {
    it(`${raw} -> ${want}`, () => expect(normalizeRoute(raw)).toBe(want));
  }

  it("collapses two different patients to the same route", () => {
    const a = normalizeRoute("/api/v1/reception/patients/JMH2026OP00001");
    const b = normalizeRoute("/api/v1/reception/patients/JMH2026OP00999");
    expect(a).toBe(b);
  });
});

describe("fingerprint - one row per defect, not per occurrence", () => {
  it("is stable for the same error", () => {
    const a = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "x is undefined");
    const b = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "x is undefined");
    expect(a).toBe(b);
  });

  it("groups the same defect across different row numbers", () => {
    const a = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "failed at row 41");
    const b = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "failed at row 87");
    expect(a).toBe(b);
  });

  it("separates different error types on the same route", () => {
    const a = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "boom");
    const b = fingerprint("RangeError", "/api/v1/billing/invoices/:id", "boom");
    expect(a).not.toBe(b);
  });

  it("separates the same error on different routes", () => {
    const a = fingerprint("TypeError", "/api/v1/billing/invoices/:id", "boom");
    const b = fingerprint("TypeError", "/api/v1/pharmacy/dispense", "boom");
    expect(a).not.toBe(b);
  });

  it("returns a short url-safe token", () => {
    const fp = fingerprint("TypeError", "/api/v1/x", "boom");
    expect(fp).toMatch(/^[a-z0-9]+$/);
    expect(fp.length).toBeLessThanOrEqual(8);
  });

  it("does not throw on a very long message", () => {
    expect(() => fingerprint("Error", "/api/v1/x", "y".repeat(50_000))).not.toThrow();
  });
});
