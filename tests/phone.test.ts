import { describe, it, expect } from "vitest";
import { toBare10, toE164, toMsisdn, isIndianMobile, formatPhone, phoneVariants } from "@/lib/phone";

/**
 * Phone normalisation is the kind of code that looks obviously correct and then
 * loses a patient's login. Every shape a receptionist, a website form or an old
 * database row could realistically supply gets a case.
 */
describe("toBare10 - strips everything that is not the ten digits", () => {
  const cases: [string, string][] = [
    ["9876543210", "9876543210"],
    ["+919876543210", "9876543210"],
    ["919876543210", "9876543210"],
    ["+91 98765 43210", "9876543210"],
    ["+91-98765-43210", "9876543210"],
    ["09876543210", "9876543210"],       // domestic dialling prefix
    ["0091 9876543210", "9876543210"],   // ISD prefix
    ["  9876543210  ", "9876543210"],
    ["(+91) 98765-43210", "9876543210"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" -> ${expected}`, () => expect(toBare10(input)).toBe(expected));
  }
  it("survives null and undefined without throwing", () => {
    expect(toBare10(null)).toBe("");
    expect(toBare10(undefined)).toBe("");
  });
});

describe("toE164 - the storage form", () => {
  it("adds the country code", () => {
    expect(toE164("9876543210")).toBe("+919876543210");
  });
  it("is idempotent - re-normalising a stored value does not double the prefix", () => {
    const once = toE164("9876543210");
    expect(toE164(once)).toBe("+919876543210");
    expect(toE164(toE164(once))).toBe("+919876543210");
  });
  it("accepts every input shape and lands on one canonical value", () => {
    const shapes = ["9876543210", "+919876543210", "919876543210", "+91 98765 43210", "09876543210"];
    expect(new Set(shapes.map(toE164)).size).toBe(1);
    expect(toE164(shapes[0])).toBe("+919876543210");
  });
  it("returns empty for junk rather than inventing a number", () => {
    // "+91undefined" written into a phone column is unrecoverable - it will
    // never match, and nobody can tell what it was meant to be.
    expect(toE164("")).toBe("");
    expect(toE164("abc")).toBe("");
    expect(toE164("12345")).toBe("");
    expect(toE164(null)).toBe("");
    expect(toE164("1234567890")).toBe(""); // starts with 1 - not an Indian mobile
  });
});

describe("isIndianMobile", () => {
  it("accepts 6-9 leading digits", () => {
    for (const lead of ["6", "7", "8", "9"]) {
      expect(isIndianMobile(`${lead}876543210`)).toBe(true);
    }
  });
  it("rejects landlines, short codes and wrong lengths", () => {
    for (const bad of ["1234567890", "5876543210", "987654321", "98765432101", "", "0000000000"]) {
      expect(isIndianMobile(bad)).toBe(false);
    }
  });
  it("accepts a number that already carries its country code", () => {
    expect(isIndianMobile("+919876543210")).toBe(true);
  });
});

describe("provider formats stay distinct", () => {
  it("Fast2SMS gets bare ten, 2Factor gets 91-prefixed", () => {
    expect(toBare10("+919876543210")).toBe("9876543210");
    expect(toMsisdn("+919876543210")).toBe("919876543210");
  });
  it("2Factor form never double-prefixes", () => {
    expect(toMsisdn(toMsisdn("9876543210"))).toBe("919876543210");
  });
});

describe("phoneVariants - finds rows written before the migration", () => {
  it("covers stored, legacy and no-plus forms", () => {
    expect(phoneVariants("9876543210")).toEqual(["+919876543210", "919876543210", "9876543210"]);
  });
  it("returns the same set whatever shape is asked for", () => {
    expect(phoneVariants("+91 98765 43210")).toEqual(phoneVariants("9876543210"));
  });
  it("is empty for junk, so a bad input matches nothing rather than everything", () => {
    expect(phoneVariants("")).toEqual([]);
    expect(phoneVariants(null)).toEqual([]);
  });
});

describe("formatPhone - what a human reads", () => {
  it("groups as 5+5 and drops the country code", () => {
    expect(formatPhone("+919876543210")).toBe("98765 43210");
    expect(formatPhone("9876543210")).toBe("98765 43210");
  });
  it("passes anything unrecognisable straight through rather than mangling it", () => {
    expect(formatPhone("extension 4021")).toBe("extension 4021");
  });
});
