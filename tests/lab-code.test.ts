import { describe, it, expect } from "vitest";
import { suggestTestCode, uniqueTestCode } from "@/lib/lab-code";
import { LAB_CATALOG } from "../prisma/lab-catalog";

describe("suggestTestCode", () => {
  it("uses the acronym the hospital already put in the name", () => {
    expect(suggestTestCode("Post Lunch Blood Sugar (PLBS)")).toBe("PLBS");
    expect(suggestTestCode("Absolute Eosinophil Count (AEC)")).toBe("AEC");
    expect(suggestTestCode("C-Reactive Protein (CRP)")).toBe("CRP");
    expect(suggestTestCode("Random Blood Sugar (RBS)")).toBe("RBS");
    expect(suggestTestCode("Renal Function Tests (RFT)")).toBe("RFT");
  });

  it("takes initials when there is no acronym to borrow", () => {
    expect(suggestTestCode("Complete Blood Picture")).toBe("CBP");
    expect(suggestTestCode("Total Protein Estimation")).toBe("TPE");
    expect(suggestTestCode("Peripheral Smear")).toBe("PS");
  });

  it("keeps a common word when it is part of the initialism", () => {
    // This lab's own code for it is LFT. Dropping "Test" as noise would give LF.
    expect(suggestTestCode("Liver Function Test")).toBe("LFT");
  });

  it("drops a common word when it is all that stands in the way", () => {
    // Two words, one of them noise: the other word IS the name.
    expect(suggestTestCode("Widal Test")).toBe("WIDAL");
    expect(suggestTestCode("Montoux Test")).toBe("MONTOUX");
  });

  it("strips punctuation out of a borrowed acronym", () => {
    // The catalogue writes (BT-CT) and codes it BTCT.
    expect(suggestTestCode("Bleeding Time & Clotting Time (BT-CT)")).toBe("BTCT");
  });

  it("turns a sex or age qualifier into a suffix", () => {
    expect(suggestTestCode("Complete Blood Picture (Male)")).toBe("CBP-M");
    expect(suggestTestCode("Complete Blood Picture (Female)")).toBe("CBP-F");
    expect(suggestTestCode("Haemoglobin (Male)")).toBe("HAEMOGLOBIN-M");
  });

  it("uses the word itself when the name is one word", () => {
    expect(suggestTestCode("Gravindex")).toBe("GRAVINDEX");
    expect(suggestTestCode("Widal")).toBe("WIDAL");
  });

  it("does not mistake a qualifier for an acronym", () => {
    // "(Urine Pregnancy)" is a description, not a code.
    expect(suggestTestCode("Gravindex Test (Urine Pregnancy)")).toBe("GRAVINDEX");
  });

  it("falls back to the whole name when every word is noise", () => {
    expect(suggestTestCode("Profile")).toBe("PROFILE");
  });

  it("survives an empty or punctuation-only name", () => {
    expect(suggestTestCode("")).toBe("");
    expect(suggestTestCode("   ")).toBe("");
    expect(suggestTestCode("()")).toBe("");
  });

  it("never suggests a code longer than the column holds", () => {
    const long = suggestTestCode("Extremely Elaborate Diagnostic Investigation Of The Entire Human Person");
    expect(long.length).toBeLessThanOrEqual(20);
  });
});

describe("uniqueTestCode", () => {
  it("returns the plain suggestion when nothing has claimed it", () => {
    expect(uniqueTestCode("Liver Function Test", ["CBP", "RBS"])).toBe("LFT");
  });

  it("steps around a code already in use", () => {
    expect(uniqueTestCode("Liver Function Test", ["LFT"])).toBe("LFT-2");
    expect(uniqueTestCode("Liver Function Test", ["LFT", "LFT-2"])).toBe("LFT-3");
  });

  it("compares case-insensitively, because the column does not care", () => {
    expect(uniqueTestCode("Liver Function Test", ["lft"])).toBe("LFT-2");
  });

  it("ignores blanks and nulls in the taken list", () => {
    expect(uniqueTestCode("Liver Function Test", [null, undefined, "  ", ""])).toBe("LFT");
  });

  it("keeps the counter intact when it has to trim, so two codes cannot merge", () => {
    // A twelve-character stem plus "-M" is 14; ask for enough collisions that
    // the counter has to be kept while the stem gives way.
    const base = suggestTestCode("Abcdefghijklmnopqrstuvwxyz (Male)");
    const out = uniqueTestCode("Abcdefghijklmnopqrstuvwxyz (Male)", [base]);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("-2")).toBe(true);
    expect(out).not.toBe(base);
  });
});

describe("the suggestions agree with the catalogue that already exists", () => {
  it("reproduces the code for the tests whose name carries one", () => {
    // Not every seeded code is derivable - "PLT" for "Platelet Count" was a
    // human choice - but where the hospital wrote the acronym into the name,
    // the suggestion has to land on the code the catalogue already uses, or a
    // technician adding a test would be handed a competing convention.
    //
    // LIPID is the one test where the hospital did NOT take its own bracketed
    // acronym: "Lipid Profile (LP)" is coded LIPID. Carved out by name rather
    // than skipped silently, so if a second exception ever appears somebody has
    // to look at it and decide whether the rule or the catalogue is wrong.
    const KNOWN_EXCEPTIONS = new Set(["LIPID"]);
    const named = LAB_CATALOG.filter(
      (c) => /\([A-Z0-9][A-Z0-9.\-/]{1,9}\)/.test(c.name) && !KNOWN_EXCEPTIONS.has(c.code),
    );
    expect(named.length).toBeGreaterThan(5);
    for (const c of named) {
      expect(suggestTestCode(c.name), c.name).toBe(c.code);
    }
  });

  it("suggests something for every test in the catalogue", () => {
    for (const c of LAB_CATALOG) {
      expect(suggestTestCode(c.name), `no code suggested for ${c.name}`).not.toBe("");
    }
  });
});
