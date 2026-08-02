import { describe, it, expect } from "vitest";
import { LAB_CATALOG, PRICE_CARRYOVER, SMEAR_PHRASES } from "../prisma/lab-catalog";
import { specimenFor, departmentFor, analyteNote, methodFor } from "@/lib/lab-reference";

/**
 * The catalogue was rewritten from the hospital's own 52 printed report forms.
 * Everything here guards the ways that rewrite can go quietly wrong.
 *
 * "Quietly" is the operative word. A result is flagged HIGH or LOW against the
 * range stored beside it, and the printed report carries a specimen line, a
 * department band and an explanatory note - all looked up by code or by analyte
 * NAME. Rename an analyte and nothing throws; the report just comes out blanker,
 * or judges a value against a range this lab does not work to.
 */

const analytes = LAB_CATALOG.flatMap((c) => c.analytes.map((a) => ({ ...a, code: c.code })));

describe("the catalogue is internally sound", () => {
  it("has a unique code per test", () => {
    const codes = LAB_CATALOG.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has a unique name per test", () => {
    // `name` is @unique in the schema - a clash fails the seed halfway through.
    const names = LAB_CATALOG.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never repeats an analyte name inside one test", () => {
    // @@unique([catalogId, name]) - a duplicate would throw mid-seed and leave
    // the catalogue half-written.
    for (const c of LAB_CATALOG) {
      const names = c.analytes.map((a) => a.name);
      expect(new Set(names).size, `${c.code} repeats an analyte`).toBe(names.length);
    }
  });

  it("gives every test at least one analyte", () => {
    // A test with no rows renders an empty results form the bench cannot fill.
    for (const c of LAB_CATALOG) {
      expect(c.analytes.length, `${c.code} has no analytes`).toBeGreaterThan(0);
    }
  });

  it("never sets a low above its high", () => {
    for (const a of analytes) {
      if (a.refLow != null && a.refHigh != null) {
        expect(a.refLow, `${a.code} / ${a.name}`).toBeLessThanOrEqual(a.refHigh);
      }
    }
  });

  it("gives every analyte something to judge against, or nothing at all", () => {
    // A half-range (a low with no high) silently flags everything above it.
    for (const a of analytes) {
      const half = (a.refLow == null) !== (a.refHigh == null);
      expect(half, `${a.code} / ${a.name} has only one end of its range`).toBe(false);
    }
  });

  it("does not put a numeric range and a text range on the same row", () => {
    for (const a of analytes) {
      const numeric = a.refLow != null || a.refHigh != null;
      expect(numeric && !!a.refText, `${a.code} / ${a.name} has both`).toBe(false);
    }
  });
});

describe("the hospital's own numbers survived transcription", () => {
  const find = (code: string, name: string) =>
    LAB_CATALOG.find((c) => c.code === code)!.analytes.find((a) => a.name === name)!;

  it("keeps male and female haemoglobin apart", () => {
    // The whole reason CBP is two entries. A woman at 12.5 Gms % is normal and
    // would read as anaemic against the male floor of 13.
    expect(find("CBP-M", "Haemoglobin").refLow).toBe(13);
    expect(find("CBP-F", "Haemoglobin").refLow).toBe(12);
  });

  it("keeps the paediatric haemogram on paediatric numbers", () => {
    // A child's white count runs far higher than an adult's; judging a healthy
    // 3-year-old against 4000-11000 flags them every time.
    expect(find("HAEMOGRAM-PED", "Total WBC Count").refHigh).toBe(15000);
    expect(find("HAEMOGRAM-F", "Total WBC Count").refHigh).toBe(11000);
  });

  it("keeps the lab's own units, not the textbook's", () => {
    // These print beside the number on the patient's report. A technician
    // proof-reading against the old paper form has to see the same words.
    expect(find("CBP-M", "Haemoglobin").unit).toBe("Gms %");
    expect(find("CBP-M", "Platelet Count").unit).toBe("Lakhs/cmm");
    expect(find("CBP-M", "Total RBC Count").unit).toBe("m/cmm");
    expect(find("ESR", "E.S.R").unit).toBe("mm 1st hr");
  });

  it("keeps this lab's liver ranges, which are not the textbook ones", () => {
    // The form says "Up - 46" and "Up - 49"; the usual printed range is 5-40.
    expect(find("LFT", "S.G.O.T").refHigh).toBe(46);
    expect(find("LFT", "S.G.P.T").refHigh).toBe(49);
    expect(find("LFT", "Serum Alkaline Phosphatase").refLow).toBe(64);
  });

  it("splits uric acid by sex on both forms that report it", () => {
    expect(find("URIC", "Serum Uric Acid (Male)").refHigh).toBe(7.0);
    expect(find("URIC", "Serum Uric Acid (Female)").refHigh).toBe(5.7);
    // RFT prints its own, slightly different pair - transcribed as printed.
    expect(find("RFT", "Serum Uric Acid (Male)").refHigh).toBe(7.2);
    expect(find("RFT", "Serum Uric Acid (Female)").refHigh).toBe(6.2);
  });

  it("keeps the infant bilirubin band, which overlaps adult liver failure", () => {
    expect(find("BILIRUBIN", "Total Bilirubin (Adults)").refHigh).toBe(1.2);
    expect(find("BILIRUBIN", "Total Bilirubin (Infants)").refHigh).toBe(12);
  });

  it("covers the whole paediatric haemoglobin ladder with no gap", () => {
    const bands = LAB_CATALOG.find((c) => c.code === "HB-PED")!.analytes;
    expect(bands).toHaveLength(7);
    for (const b of bands) expect(b.refLow, b.name).not.toBeNull();
  });
});

describe("the printed report still finds everything", () => {
  it("knows the specimen for every test", () => {
    // A missing specimen silently drops the line off the report.
    for (const c of LAB_CATALOG) {
      expect(specimenFor(c.code), `no specimen for ${c.code}`).not.toBeNull();
    }
  });

  it("knows the department band for every test", () => {
    for (const c of LAB_CATALOG) {
      expect(departmentFor(c.code), `no department for ${c.code}`).not.toBeNull();
    }
  });

  it("agrees with the spec's own grouping", () => {
    // Two names for one test's home, at deliberately different granularity:
    // `group` is the ordering screen's shelf, where "Blood Sugar" as its own
    // heading saves the desk reading through all of biochemistry; DEPARTMENTS
    // is the band printed on the report, which follows the lab's actual
    // sections. They may differ - but only in the ways listed here, so a typo
    // in either still fails.
    const GROUP_PRINTS_AS: Record<string, string> = {
      Haematology: "HAEMATOLOGY",
      "Blood Banking": "BLOOD BANKING",
      "Blood Sugar": "BIOCHEMISTRY",
      Biochemistry: "BIOCHEMISTRY",
      Serology: "SEROLOGY",
      "Clinical Pathology": "CLINICAL PATHOLOGY",
      Profiles: "PROFILES",
    };
    for (const c of LAB_CATALOG) {
      const expected = GROUP_PRINTS_AS[c.group];
      expect(expected, `${c.code} sits in unknown group "${c.group}"`).toBeDefined();
      expect(departmentFor(c.code), c.code).toBe(expected);
    }
  });

  it("still finds the notes for analytes that were renamed", () => {
    // The rewrite renamed these; the notes are keyed on the OLD spelling and
    // resolve through the alias map. Without it the report goes blank here.
    for (const n of ["S.G.O.T", "S.G.P.T", "Total RBC Count", "Haematocrit (PCV)",
                     "Serum Alkaline Phosphatase", "Cholesterol", "VLDL",
                     "Rheumatoid Factor", "Dengue Check NS1", "Fasting Blood Sugar"]) {
      expect(analyteNote(n), `no note for ${n}`).not.toBeNull();
    }
  });

  it("still finds the notes under the OLD names too", () => {
    // Results already reported are stored with the name as it was THEN, and
    // re-opening a March report re-renders from those rows.
    for (const n of ["SGOT (AST)", "SGPT (ALT)", "RBC Count", "PCV (Haematocrit)",
                     "Total Cholesterol", "RA Factor", "Dengue NS1 Antigen"]) {
      expect(analyteNote(n), `no note for legacy name ${n}`).not.toBeNull();
    }
  });

  it("still prints the analyser method under both spellings", () => {
    expect(methodFor("Total RBC Count")).toBe(methodFor("RBC Count"));
    expect(methodFor("Haematocrit (PCV)")).toBe(methodFor("PCV (Haematocrit)"));
    expect(methodFor("E.S.R")).toBe("Westergren");
  });
});

describe("prices", () => {
  it("only carries a price forward from a code that used to exist", () => {
    // A typo here silently lands a test at ₹0 with no warning in the seed
    // output, because the carryover just misses.
    const OLD = new Set(["CBP", "FBS", "PPBS", "RBS", "HBA1C", "LIPID", "LFT", "BILIRUBIN",
                         "KFT", "CREAT", "URIC", "AMYLASE", "THYROID", "VITD", "VITB12",
                         "CRP", "ESR", "RAF", "URINE", "DENGUE", "WIDAL",
                         "XRAYCHEST", "ECG", "ECHO"]);
    for (const [to, from] of Object.entries(PRICE_CARRYOVER)) {
      expect(OLD.has(from), `${to} carries from unknown code ${from}`).toBe(true);
    }
  });

  it("only carries a price to a test that exists now", () => {
    const codes = new Set(LAB_CATALOG.map((c) => c.code));
    for (const to of Object.keys(PRICE_CARRYOVER)) {
      expect(codes.has(to), `carryover targets unknown code ${to}`).toBe(true);
    }
  });
});

describe("the smear phrase book", () => {
  it("is kept, and is not mistaken for a test", () => {
    // "Blood picture.docx" is the phrase list the bench picks from so two
    // technicians describe the same slide the same way. It is data, not a
    // catalogue entry, and nothing seeds it into LabAnalyte.
    expect(SMEAR_PHRASES.rbc.length).toBeGreaterThan(5);
    expect(SMEAR_PHRASES.wbc.length).toBeGreaterThan(15);
    expect(SMEAR_PHRASES.platelets.length).toBeGreaterThan(3);
    expect(LAB_CATALOG.some((c) => c.name.toLowerCase().includes("phrase"))).toBe(false);
  });
});
