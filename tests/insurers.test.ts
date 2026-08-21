import { describe, it, expect } from "vitest";
import { INSURERS, mergeInsurers, insurerKey, BUILT_IN_KIND } from "@/lib/insurers";

/**
 * THE LIST EVERY "INSURER / TPA" BOX SHOWS.
 *
 * Reception's admission form, the ward board and the claim form all suggest from
 * one list: the names compiled into the app, plus whatever the hospital has
 * added, minus whatever it has switched off.
 *
 * The compiled list is the FLOOR, and that is the property most of these tests
 * are really about. A receptionist admitting a patient on a trolley cannot be
 * left staring at an empty box because a table is empty, a query failed, or a
 * database is half-restored.
 */

describe("the built-in list itself", () => {
  it("has no duplicate names, in any spelling", () => {
    // Two spellings of one TPA split that insurer's row on the analytics board
    // between them, and the board then shows it owing half of what it owes.
    const keys = INSURERS.map(insurerKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts every name in a group, so the manage screen can file it", () => {
    for (const n of INSURERS) expect(BUILT_IN_KIND[n]).toBeTruthy();
  });

  it("still carries the names the hospital has been typing since before this table existed", () => {
    // These are stored as-is on admissions and claims. Re-spelling one here
    // would bucket every stay booked afterwards under a different insurer.
    for (const n of ["Star Health", "Paramount TPA", "Health India TPA", "Aarogyasri (State scheme)", "CGHS", "ECHS"]) {
      expect(INSURERS).toContain(n);
    }
  });
});

describe("merging the hospital's own list in", () => {
  it("is exactly the built-in list when nothing has been curated", () => {
    expect(mergeInsurers([])).toEqual([...INSURERS]);
  });

  it("appends an added name after the built-ins", () => {
    const out = mergeInsurers([{ name: "Yashoda TPA", active: true }]);
    expect(out).toHaveLength(INSURERS.length + 1);
    expect(out[out.length - 1]).toBe("Yashoda TPA");
    // The twenty names that cover most admissions stay at the top, where
    // somebody in a hurry reads them.
    expect(out[0]).toBe(INSURERS[0]);
  });

  it("hides a built-in that has been switched off", () => {
    const out = mergeInsurers([{ name: "Acko General", active: false }]);
    expect(out).not.toContain("Acko General");
    expect(out).toHaveLength(INSURERS.length - 1);
  });

  it("hides it however the name was cased or spaced when it was stored", () => {
    expect(mergeInsurers([{ name: "  star   health ", active: false }])).not.toContain("Star Health");
  });

  it("does not list a name twice when a stored row repeats a built-in", () => {
    const out = mergeInsurers([{ name: "star health", active: true }]);
    expect(out.filter((n) => insurerKey(n) === "star health")).toHaveLength(1);
    expect(out).toContain("Star Health");
  });

  it("keeps the built-in spelling, not the stored one, when the two differ", () => {
    // What goes on a claim should be the name this hospital has always used,
    // not whatever casing somebody typed into the manage screen.
    expect(mergeInsurers([{ name: "STAR HEALTH", active: true }])).toContain("Star Health");
  });

  it("drops a switched-off row the hospital added itself", () => {
    const out = mergeInsurers([
      { name: "Yashoda TPA", active: true },
      { name: "Old TPA", active: false },
    ]);
    expect(out).toContain("Yashoda TPA");
    expect(out).not.toContain("Old TPA");
  });

  it("ignores a blank row rather than offering an empty suggestion", () => {
    expect(mergeInsurers([{ name: "   ", active: true }])).toEqual([...INSURERS]);
  });

  it("never returns duplicates, whatever it is handed", () => {
    const out = mergeInsurers([
      { name: "Yashoda TPA", active: true },
      { name: "yashoda tpa", active: true },
      { name: "Star Health", active: true },
    ]);
    expect(new Set(out.map(insurerKey)).size).toBe(out.length);
  });
});

describe("two names are the same insurer when", () => {
  it("they differ only in case", () => {
    expect(insurerKey("Star Health")).toBe(insurerKey("STAR HEALTH"));
  });

  it("they differ only in surrounding or repeated spaces", () => {
    expect(insurerKey(" Star   Health ")).toBe(insurerKey("Star Health"));
  });

  it("but not when the words differ - Health India and Good Health are two TPAs", () => {
    expect(insurerKey("Health India TPA")).not.toBe(insurerKey("Good Health (TPA)"));
  });
});
