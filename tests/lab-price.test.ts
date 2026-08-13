import { describe, it, expect } from "vitest";
import { samePaise, priceChanges, duplicateId, parsePrice } from "@/lib/lab-price";

/**
 * The price grid corrects the whole catalogue in one submit, which makes the
 * "what actually moved" decision the only thing standing between a routine fix
 * and a hospital's entire test menu being rewritten by somebody who opened a
 * screen and pressed Save.
 *
 * Every case here is a way that goes wrong quietly - a price silently reverted,
 * a rate the audit log claims changed when it did not, a zero that looks like a
 * price. None of it needs a database.
 */

const rows = (...xs: [string, string, string | number][]) =>
  xs.map(([id, name, price]) => ({ id, name, price }));

describe("what counts as a price at all", () => {
  it("reads the ordinary ones", () => {
    expect(parsePrice("400")).toBe(400);
    expect(parsePrice("400.00")).toBe(400);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice(650)).toBe(650);
  });

  it("refuses a blank, which is not the same as free", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("   ")).toBeNull();
  });

  it("refuses the second decimal point the input filter lets through", () => {
    // The grid strips letters but not a stray dot, so "6.5.0" reaches here as a
    // string that Number() calls NaN. A row that will not parse must be marked
    // on the screen, not skipped in silence.
    expect(parsePrice("6.5.0")).toBeNull();
    expect(parsePrice(".")).toBeNull();
  });

  it("refuses a negative, which Decimal(10,2) would happily store", () => {
    expect(parsePrice("-50")).toBeNull();
  });
});

describe("a price is the same price however it was typed", () => {
  it("treats 400 and 400.00 as unchanged", () => {
    // The catalogue stores Decimal(10,2), so it hands back "400.00" for a rate
    // somebody typed as "400". Comparing the strings would mark every row on
    // the screen as edited the moment it loaded.
    expect(samePaise("400", "400.00")).toBe(true);
    expect(samePaise(400, "400.0000")).toBe(true);
  });

  it("does not lose a one-paise difference", () => {
    expect(samePaise("400.00", "400.01")).toBe(false);
  });

  it("survives the float that does not add up", () => {
    // 0.1 + 0.2 === 0.30000000000000004. Raw === would call this a change and
    // write a row nobody edited.
    expect(samePaise(0.1 + 0.2, 0.3)).toBe(true);
  });

  it("separates ₹0 from a blank that parsed to nothing", () => {
    // Number("") is 0. If that counted as the price zero, a cleared box would
    // read as the decision "this test is free" - the exact bug the price screen
    // was built to fix, arriving through the fix.
    expect(samePaise("", 0)).toBe(false);
    expect(samePaise("abc", 0)).toBe(false);
  });

  it("will not call a cleared box unchanged against a real price", () => {
    // The dangerous direction. A box emptied by accident on a ₹300 test must
    // not compare as anything at all - not equal, and not "changed to zero".
    expect(samePaise("", "300.00")).toBe(false);
    expect(samePaise("", "")).toBe(false);
  });
});

describe("only what moved is written", () => {
  it("returns nothing when the whole grid is resubmitted untouched", () => {
    const existing = rows(["a", "CBP", "300.00"], ["b", "CUE", "150.00"]);
    const out = priceChanges(existing, [{ id: "a", price: 300 }, { id: "b", price: 150 }]);
    expect(out).toEqual([]);
  });

  it("picks out the one row that changed among many", () => {
    const existing = rows(["a", "CBP", "300.00"], ["b", "CUE", "150.00"], ["c", "LFT", "0.00"]);
    const out = priceChanges(existing, [
      { id: "a", price: 300 }, { id: "b", price: 150 }, { id: "c", price: 650 },
    ]);
    expect(out).toEqual([{ id: "c", name: "LFT", from: 0, to: 650 }]);
  });

  it("carries the name and the old price, so the audit log can be read", () => {
    // "who dropped the CBP to 50" has to be answerable from the log alone -
    // by then the row says 50 and the previous value exists nowhere else.
    const out = priceChanges(rows(["a", "CBP", "300.00"]), [{ id: "a", price: 50 }]);
    expect(out[0]).toEqual({ id: "a", name: "CBP", from: 300, to: 50 });
  });

  it("counts a correction DOWN to zero as a real change", () => {
    // Not a no-op to be optimised away: making a test free is a decision, and
    // it is exactly the one somebody would want to find in the log later.
    const out = priceChanges(rows(["a", "CBP", "300.00"]), [{ id: "a", price: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe(0);
  });

  it("leaves out a test that is not in the catalogue rather than inventing one", () => {
    const out = priceChanges(rows(["a", "CBP", "300.00"]), [
      { id: "a", price: 400 }, { id: "gone", price: 999 },
    ]);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("never touches a test the grid did not submit", () => {
    // The submit is a list of corrections, not a replacement catalogue. A test
    // filtered off the screen must come through untouched.
    const existing = rows(["a", "CBP", "300.00"], ["b", "CUE", "150.00"]);
    const out = priceChanges(existing, [{ id: "a", price: 400 }]);
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("one test cannot be given two prices in one submit", () => {
  it("names the repeated id", () => {
    expect(duplicateId(["a", "b", "a"])).toBe("a");
  });

  it("passes a clean submit", () => {
    expect(duplicateId(["a", "b", "c"])).toBeNull();
    expect(duplicateId([])).toBeNull();
  });
});

describe("the zeros this screen exists for", () => {
  it("prices a catalogue the import left at ₹0 without touching the priced rows", () => {
    // The shape of the real fix: the seed carried prices over for the tests it
    // could match and left the rest at zero.
    const existing = rows(
      ["a", "CBP", "300.00"],   // carried over
      ["b", "LFT", "0.00"],     // no carryover - free to the patient today
      ["c", "RFT", "0.00"],
    );
    const out = priceChanges(existing, [
      { id: "a", price: 300 }, { id: "b", price: 650 }, { id: "c", price: 700 },
    ]);
    expect(out.map((c) => [c.name, c.from, c.to])).toEqual([["LFT", 0, 650], ["RFT", 0, 700]]);
  });
});
