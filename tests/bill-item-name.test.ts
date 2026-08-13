import { describe, it, expect } from "vitest";
import { billItemName, billItemBatch } from "@/lib/bill-item-name";

/**
 * The name column on a printed bill.
 *
 * The pharmacy writes the batch, the MRP and the pack size into the description
 * because all three are real and it is the only field it has. The bill is not
 * where they belong - the rate and amount are already their own columns - so
 * they are stripped at print time.
 *
 * The tests that matter here are the NEGATIVE ones. Stripping is easy; the way
 * this goes wrong is by stripping too much, and the lines most at risk are the
 * bed and nursing charges, which use the same "·" separator and whose detail is
 * the only thing that makes a room charge checkable.
 */

describe("pharmacy lines lose the batch and the price", () => {
  it("cuts a full pack line down to the medicine", () => {
    expect(billItemName("Dolo 650 · 10 tablets @ ₹2.50 (pack of 15 · MRP ₹37.50) · Batch AX2291"))
      .toBe("Dolo 650");
  });

  it("cuts a loose line down to the medicine", () => {
    expect(billItemName("Azithral 500 (Tablet) · Batch B-9931")).toBe("Azithral 500");
  });

  it("handles a single unit, where the writer drops the plural", () => {
    expect(billItemName("Pan 40 · 1 tablet @ ₹8.00 (pack of 10 · MRP ₹80.00) · Batch P1"))
      .toBe("Pan 40");
  });

  it("keeps a medicine name that has its own numbers", () => {
    // "650" is part of the drug, not a quantity. Losing it would name the wrong
    // strength on a document a patient may take to another doctor.
    expect(billItemName("Dolo 650 · Batch X1")).toBe("Dolo 650");
    expect(billItemName("Augmentin 625 Duo (Tablet) · Batch Z9")).toBe("Augmentin 625 Duo");
  });

  it("drops a trailing unit but keeps a meaningful parenthetical", () => {
    expect(billItemName("Ascoril (Syrup)")).toBe("Ascoril");
    // Not a dispensing unit - this parenthetical IS the name.
    expect(billItemName("CBP (Complete Blood Picture)")).toBe("CBP (Complete Blood Picture)");
  });
});

describe("everything else is left alone", () => {
  it("keeps the whole bed charge, separators and all", () => {
    // The line the user asked to see ON the bill. Cutting at the first "·" would
    // print "Bed" - no ward, no bed number, no nights - and a room charge nobody
    // can check is a room charge patients argue about.
    const bed = "Bed · Deluxe-04 · 3 days";
    expect(billItemName(bed)).toBe(bed);
  });

  it("keeps the nursing line's days and rate", () => {
    const nursing = "Nursing care · 3 day(s) × ₹600";
    expect(billItemName(nursing)).toBe(nursing);
  });

  it("keeps the long fallback bed description", () => {
    const bed = "Bed charges · General Ward · G-12 · IP2026-0041 · 4 day(s)";
    expect(billItemName(bed)).toBe(bed);
  });

  it("keeps a plain consultation or lab line untouched", () => {
    expect(billItemName("Consultation - Dr. Rao")).toBe("Consultation - Dr. Rao");
    expect(billItemName("Complete Blood Picture")).toBe("Complete Blood Picture");
  });

  it("keeps a hand-typed charge with a rupee sign in it", () => {
    // Typed by a desk on the running tab - no batch, no pack, so nothing to cut.
    const typed = "Oxygen support · 6 hours";
    expect(billItemName(typed)).toBe(typed);
  });
});

describe("it never returns nothing", () => {
  it("falls back to the original rather than printing a blank line", () => {
    // A description that is only a batch would otherwise strip to "".
    expect(billItemName("· Batch AX1")).toBe("· Batch AX1");
  });

  it("survives an empty or whitespace description", () => {
    expect(billItemName("")).toBe("");
    expect(billItemName("   ")).toBe("");
  });
});

/**
 * THE BATCH GETS ITS OWN COLUMN.
 *
 * Out of the name, but never off the bill: a pharmacy invoice has to carry the
 * batch of what was dispensed. It is what a recall is worked backwards from and
 * what a returned strip is checked against.
 */
describe("the batch is extracted, not discarded", () => {
  it("pulls the batch off a full pack line", () => {
    expect(billItemBatch("Dolo 650 · 10 tablets @ ₹2.50 (pack of 15 · MRP ₹37.50) · Batch AX2291"))
      .toBe("AX2291");
  });

  it("pulls the batch off a loose line", () => {
    expect(billItemBatch("Azithral 500 (Tablet) · Batch B-9931")).toBe("B-9931");
  });

  it("returns null for anything that is not a dispensed medicine", () => {
    // This is what keeps the Batch column off a consultation or lab bill - a
    // heading over a column of dashes is worse than no column at all.
    expect(billItemBatch("Consultation - Dr. Rao")).toBeNull();
    expect(billItemBatch("Bed · Deluxe-04 · 3 days")).toBeNull();
    expect(billItemBatch("Nursing care · 3 day(s) × ₹600")).toBeNull();
    expect(billItemBatch("Complete Blood Picture")).toBeNull();
    expect(billItemBatch("")).toBeNull();
  });

  it("splits one description into a clean name AND a batch", () => {
    // The pair is the whole point: neither piece is lost, they just stop
    // sharing one cell.
    const d = "Pan 40 · 1 tablet @ ₹8.00 (pack of 10 · MRP ₹80.00) · Batch P1";
    expect(billItemName(d)).toBe("Pan 40");
    expect(billItemBatch(d)).toBe("P1");
  });
});
