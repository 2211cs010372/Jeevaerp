import { describe, it, expect } from "vitest";
import { parsePack, packsToUnits, perUnitPrice, describeStock } from "@/lib/pharmacy/pack";

/**
 * The pack/unit boundary. Every number in the pharmacy sits on one side of it,
 * and the bug this replaced was one number trying to be on both:
 *
 *   3 strips of PARACETAMOL 15T is 45 tablets, not 3.
 *   MRP 18.59 is the price of the strip, not of a tablet.
 */

describe("reading a pack label", () => {
  it("reads tablets", () => {
    expect(parsePack("15T")).toEqual({ size: 15, unit: "tablet", known: true });
    expect(parsePack("10TAB")).toEqual({ size: 10, unit: "tablet", known: true });
  });

  it("treats a volume as ONE bottle, not as that many units", () => {
    // This assertion used to read `size: 200`, and it was wrong in production.
    // ACIFIX RAFT 200ML was received as twelve bottles and landed on the shelf
    // as 2,400 - because 200 was read as a count of dispensing units instead of
    // as how much is inside one bottle. Its Rs 231 MRP then divided down to
    // Rs 1.16, which is what the counter would have charged for a whole bottle.
    //
    // Nobody measures out 30ml at the counter. The bottle is the unit.
    expect(parsePack("200ML")).toEqual({ size: 1, unit: "bottle", known: true });
    expect(parsePack("500ML")).toEqual({ size: 1, unit: "bottle", known: true });
    expect(parsePack("15ML")).toEqual({ size: 1, unit: "bottle", known: true });
  });

  it("treats a weight as ONE tube, for the same reason", () => {
    // PLACENTREX GEL 20 GM: one tube, not twenty grams off a shelf.
    expect(parsePack("20GM")).toEqual({ size: 1, unit: "tube", known: true });
    expect(parsePack("100G")).toEqual({ size: 1, unit: "tube", known: true });
  });

  it("keeps counting labels counting - the distinction is the whole point", () => {
    // Tablets and capsules DO leave the shelf one at a time, so their pack size
    // is a real multiplier. Collapsing these to 1 would be the mirror-image bug:
    // a strip of fifteen would read as one, and dispensing two would be refused.
    expect(parsePack("15T").size).toBe(15);
    expect(parsePack("10C").size).toBe(10);
    expect(parsePack("10`S").size).toBe(10);
    expect(parsePack("5V").size).toBe(5);
    expect(parsePack("2R").size).toBe(2);
  });

  it("prices a bottle at the printed MRP, not at a fraction of it", () => {
    // The arithmetic the bug got wrong, stated as money.
    const { size } = parsePack("200ML");
    expect(perUnitPrice(231, size)).toBe(231);
    expect(packsToUnits(12, size)).toBe(12);
  });

  it("reads capsules and the other dosage forms on these invoices", () => {
    expect(parsePack("15C").unit).toBe("capsule");
    expect(parsePack("5SUPP").unit).toBe("suppository");
    expect(parsePack("2R").unit).toBe("respule");
  });

  it("understands the trade's \"10's\" shorthand, however OCR mangles it", () => {
    // "10`S", "10'S", "10S" all mean ten of them - S is not a unit.
    for (const label of ["10`S", "10'S", "10S", "10’S", "10,S"]) {
      const p = parsePack(label);
      expect(p.size, label).toBe(10);
      expect(p.unit, label).toBe("unit");
    }
  });

  it("takes a bare number as a count", () => {
    expect(parsePack("30")).toEqual({ size: 30, unit: "unit", known: true });
  });

  it("survives the whitespace and noise OCR leaves", () => {
    expect(parsePack(" 15 T ").size).toBe(15);
  });

  it("REFUSES to guess at a label it cannot read", () => {
    // This is the important one. A wrong pack size multiplies the whole shelf
    // by a factor nobody notices until a physical count. Falling back to 1
    // treats the stock as loose units - understated, but never invented.
    for (const bad of ["", null, undefined, "STRIP", "N/A", "1x10x15"]) {
      const p = parsePack(bad as string);
      expect(p.size, String(bad)).toBe(1);
      expect(p.known, String(bad)).toBe(false);
    }
  });

  it("refuses an implausible size rather than trusting it", () => {
    expect(parsePack("99999T").known).toBe(false);
    expect(parsePack("0T").known).toBe(false);
  });
});

describe("packs to units", () => {
  it("converts a delivery to what is actually on the shelf", () => {
    // The scenario from the counter: 3 strips of 15 is 45 tablets.
    expect(packsToUnits(3, 15)).toBe(45);
  });

  it("treats a loose item as itself", () => {
    expect(packsToUnits(7, 1)).toBe(7);
  });

  it("never multiplies by zero when the pack is unknown", () => {
    expect(packsToUnits(4, 0)).toBe(4);
  });
});

describe("per-unit price", () => {
  it("divides the printed MRP across the strip", () => {
    // The overcharge this fixes: 5 tablets billed at strip price was Rs 92.95.
    expect(perUnitPrice(18.59, 15)).toBe(1.24);
    expect(perUnitPrice(1.24, 1) * 5).toBeCloseTo(6.2, 2);
  });

  it("leaves a loose item's price alone", () => {
    expect(perUnitPrice(295, 1)).toBe(295);
  });

  it("rounds to paise - a third decimal is not money", () => {
    expect(perUnitPrice(100, 3)).toBe(33.33);
  });
});

describe("what the shelf should say", () => {
  it("shows units AND the boxes to look for", () => {
    expect(describeStock(45, 15, "tablet", "15T")).toBe("45 tablets (3 x 15T)");
  });

  it("calls out a part-used strip", () => {
    expect(describeStock(38, 15, "tablet", "15T")).toBe("38 tablets (2 x 15T + 8 loose)");
  });

  it("stays plain for loose stock", () => {
    expect(describeStock(12, 1, "bottle")).toBe("12 bottles");
  });
});
