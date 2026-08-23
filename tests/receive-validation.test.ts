import { describe, it, expect } from "vitest";
import {
  lineIsReady, lineProblems, receiptBlocker, type ReceiveLine,
} from "@/lib/pharmacy/receive-validation";

/**
 * The receiving desk's complaint, in one sentence: sometimes a delivery would
 * not post and the screen would not say why.
 *
 * Both halves of that are pinned here - that every missing box is NAMED, and
 * that the box it names is the one the grid marks. The two regressions at the
 * bottom are the exact shapes that used to produce a bare "1 line needs
 * attention." with no reason attached, which is the dead end that sent a
 * technician back to re-reading twenty rows off the paper invoice.
 */

/** A line with nothing wrong with it. Each test breaks one thing. */
const good = (over: Partial<ReceiveLine> = {}): ReceiveLine => ({
  medicineId: "med_1", name: "Paracetamol 500", batchNo: "B12", expiryDate: "2027-04-30",
  qty: "10", freeQty: "1", ...over,
});
const on = (l: ReceiveLine, field: string) => lineProblems(l).find((p) => p.field === field);

describe("a line that is ready", () => {
  it("reports nothing", () => {
    expect(lineProblems(good())).toEqual([]);
    expect(lineIsReady(good())).toBe(true);
  });

  it("does not require a free quantity", () => {
    expect(lineProblems(good({ freeQty: "" }))).toEqual([]);
  });
});

describe("the message matches the box it sits under", () => {
  it("says Not selected under the catalogue dropdown", () => {
    expect(on(good({ medicineId: "" }), "medicine")?.message).toBe("Not selected");
  });

  it("says Not filled under the new-product text box", () => {
    // Same empty line, but the row is in "+ new product" mode - there is a text
    // input there, and telling somebody to SELECT something in one is nonsense.
    const l = good({ medicineId: "", createNew: true, name: "" });
    expect(on(l, "medicine")?.message).toBe("Not filled");
  });

  it("says Not filled for a batch number and Not selected for a date", () => {
    expect(on(good({ batchNo: "  " }), "batch")?.message).toBe("Not filled");
    expect(on(good({ expiryDate: "" }), "expiry")?.message).toBe("Not selected");
  });
});

describe("quantities", () => {
  it("names a blank quantity", () => {
    expect(on(good({ qty: "" }), "qty")?.message).toBe("Not filled");
  });

  it("rejects zero, which is not a delivery", () => {
    expect(on(good({ qty: "0" }), "qty")?.message).toBe("Must be more than 0");
  });

  it("rejects a fractional pack count on either column", () => {
    // StockBatch.quantity is an integer column; posting 2.5 is a 400 from the
    // API with nothing on screen explaining it.
    expect(on(good({ qty: "2.5" }), "qty")?.message).toBe("Whole packs only");
    expect(on(good({ freeQty: "0.5" }), "free")?.message).toBe("Whole packs only");
  });
});

describe("when a mark is allowed to appear", () => {
  it("flags an EMPTY box as one that waits for Post", () => {
    for (const l of [good({ medicineId: "" }), good({ qty: "" }), good({ batchNo: "" }), good({ expiryDate: "" })]) {
      expect(lineProblems(l)[0].empty).toBe(true);
    }
  });

  it("flags a box holding something unusable as one that answers immediately", () => {
    // The pharmacist is looking straight at what they typed; there is nothing
    // to wait for.
    expect(on(good({ qty: "2.5" }), "qty")?.empty).toBe(false);
    expect(on(good({ qty: "0" }), "qty")?.empty).toBe(false);
    expect(on(good({ freeQty: "0.5" }), "free")?.empty).toBe(false);
  });
});

describe("the sentence beside the Post button", () => {
  it("asks for the supplier before anything about the lines", () => {
    expect(receiptBlocker("", [good()])).toBe("Choose the supplier this delivery came from.");
  });

  it("asks for a line when the grid is empty", () => {
    expect(receiptBlocker("sup_1", [])).toBe("Add at least one line.");
  });

  it("goes quiet once every line is ready", () => {
    expect(receiptBlocker("sup_1", [good(), good()])).toBeNull();
  });

  it("names every distinct fault, with a count each", () => {
    const b = receiptBlocker("sup_1", [
      good(),
      good({ batchNo: "" }),
      good({ batchNo: "", expiryDate: "" }),
    ]);
    expect(b).toContain("2 lines need attention");
    expect(b).toContain("2 with no batch number");
    expect(b).toContain("1 with no expiry date");
  });

  it("counts a line once however many ways it is wrong", () => {
    const b = receiptBlocker("sup_1", [good({ medicineId: "", batchNo: "", expiryDate: "", qty: "" })]);
    expect(b).toContain("1 line needs attention");
  });
});

/**
 * THE TWO SHAPES THAT USED TO SAY NOTHING.
 *
 * The old summary was written out by hand beside the validity check instead of
 * derived from it, so it had branches the check did not. Both of these left the
 * Post button greyed out under the words "1 line needs attention." and no
 * further explanation anywhere on the screen.
 */
describe("regressions - faults the screen used to hide", () => {
  it("names the quantity when that is the only thing missing", () => {
    // The old breakdown had no branch for qty at all.
    const b = receiptBlocker("sup_1", [good({ qty: "" })]);
    expect(b).toContain("with no quantity");
  });

  it("names batch and expiry on a NEW-product line", () => {
    // The old counts were guarded on `r.medicineId`, so a line for a product
    // the catalogue has never seen - most of a delivery, straight after OCR -
    // was skipped by both of them.
    const l = good({ medicineId: "", createNew: true, name: "New Syrup 100ml", batchNo: "", expiryDate: "" });
    const b = receiptBlocker("sup_1", [l]);
    expect(b).toContain("with no batch number");
    expect(b).toContain("with no expiry date");
    // …and the product itself is fine, because the name carries it.
    expect(on(l, "medicine")).toBeUndefined();
  });
});
