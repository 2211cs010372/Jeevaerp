import { describe, expect, it } from "vitest";
import { parsePrescriptionText } from "../src/lib/prescription-parse";
import { roundInvoiceBillPrice } from "../src/lib/pharmacy/procurement-math";

describe("AI Vision OCR and Prescription Math", () => {
  it("expands brand shorthands correctly", () => {
    const rawText = "Rx\n1. PCM 650mg 1-0-1 5 days\n2. Amox 500mg 1-0-1 7 days";
    const parsed = parsePrescriptionText(rawText);
    expect(parsed.medicines.length).toBeGreaterThan(0);
    expect(parsed.medicines[0].medicineName).toContain("PARACETAMOL");
  });

  it("applies invoice price rounding rules correctly", () => {
    // Ends in 5 -> neutral
    expect(roundInvoiceBillPrice(105)).toBe("105");
    // Ends in <5 -> 10
    expect(roundInvoiceBillPrice(103)).toBe("100");
    expect(roundInvoiceBillPrice(104)).toBe("100");
    // Ends in >5 -> 20
    expect(roundInvoiceBillPrice(106)).toBe("110");
    expect(roundInvoiceBillPrice(108)).toBe("110");
  });
});
