import { describe, it, expect } from "vitest";
import { forgottenBillSchema } from "@/server/validators/ipd";

/**
 * FORGOTTEN SERVICES - the third kind of forgotten bill (owner, 1 Oct 2026).
 *
 * Rate-card services land on the stay as IP charges, so what the desk sends has
 * to look like a tab line: a category, a description, a qty and a rate. The
 * pharmacy category is not one of them - a medicine has stock behind it and
 * goes through the Pharmacy tab.
 */
describe("what a forgotten service request may carry", () => {
  const line = { category: "PROCEDURE", description: "Dressing - major", qty: 2, unitPrice: 300 };

  it("accepts rate-card lines with a day in the stay and a payment", () => {
    const r = forgottenBillSchema.parse({
      kind: "SERVICE", lines: [line, { ...line, category: "OXYGEN", description: "Oxygen", qty: 3, unitPrice: 500, gstRatePct: 0 }],
      billDate: "2026-08-08", payments: [{ mode: "CASH", amount: 2100 }],
    });
    expect(r.kind).toBe("SERVICE");
    if (r.kind === "SERVICE") expect(r.lines).toHaveLength(2);
  });

  it("needs at least one service", () => {
    expect(() => forgottenBillSchema.parse({ kind: "SERVICE", lines: [] })).toThrow();
  });

  it("sends medicines to the Pharmacy tab, not here", () => {
    expect(() => forgottenBillSchema.parse({ kind: "SERVICE", lines: [{ ...line, category: "PHARMACY" }] })).toThrow();
  });

  it("refuses a nameless or free line", () => {
    expect(() => forgottenBillSchema.parse({ kind: "SERVICE", lines: [{ ...line, description: " " }] })).toThrow();
    expect(() => forgottenBillSchema.parse({ kind: "SERVICE", lines: [{ ...line, qty: 0 }] })).toThrow();
    expect(() => forgottenBillSchema.parse({ kind: "SERVICE", lines: [{ ...line, unitPrice: -1 }] })).toThrow();
  });
});
