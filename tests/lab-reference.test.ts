import { describe, expect, it } from "vitest";
import { analyteDescription, analyteFlagNote, analyteNote, bandFor, departmentFor, specimenFor } from "@/lib/lab-reference";

/**
 * The reference notes are the only prose on a lab report, and the patient reads
 * them without a doctor in the room. Two failure modes matter, and neither one
 * throws: a note that doesn't attach to its analyte (a blank line where an
 * explanation should be), and a note that attaches to the WRONG direction -
 * telling someone their high reading means what a low one does. Both are pinned
 * here.
 */

describe("analyteDescription", () => {
  it("finds the note for an analyte as the template names it", () => {
    expect(analyteDescription("Haemoglobin")).toMatch(/oxygen-carrying/i);
  });

  it("ignores case, spacing and punctuation", () => {
    // The bench types these by hand on an added line; "TSH", "tsh" and "T.S.H."
    // are the same analyte and must find the same note.
    expect(analyteDescription("tsh")).toBe(analyteDescription("TSH"));
    expect(analyteDescription("T.S.H.")).toBe(analyteDescription("TSH"));
  });

  it("matches a name whose bracketed part is in the template", () => {
    expect(analyteDescription("PCV (Haematocrit)")).toMatch(/red cells/i);
    expect(analyteDescription("SGPT (ALT)")).toMatch(/liver/i);
  });

  it("falls back by dropping a bracketed suffix the template doesn't carry", () => {
    // "Haemoglobin (Hb)" is not a template name, but it is unmistakably
    // haemoglobin - and a report line with no note reads like an oversight.
    expect(analyteDescription("Haemoglobin (Hb)")).toBe(analyteDescription("Haemoglobin"));
  });

  it("returns null for an analyte it has never heard of", () => {
    // The sheet prints nothing rather than "undefined". A lab can add any line
    // it likes; the notes are a courtesy, not a gate.
    expect(analyteDescription("Serum Widgetase")).toBeNull();
    expect(analyteDescription("")).toBeNull();
  });
});

describe("analyteFlagNote", () => {
  it("gives the high note for a high value and the low note for a low one", () => {
    const high = analyteFlagNote("TSH", "HIGH");
    const low = analyteFlagNote("TSH", "LOW");
    // TSH is the one analyte on the sheet that reads backwards - a HIGH TSH is
    // an UNDER-active thyroid. If these two ever swap, the sheet tells the
    // patient the opposite of the truth.
    expect(high).toMatch(/under-?active/i);
    expect(low).toMatch(/over-?active/i);
  });

  it("says nothing about a value that is inside its range", () => {
    expect(analyteFlagNote("TSH", "NORMAL")).toBeNull();
  });

  it("says nothing for an abnormal flag with no direction", () => {
    // "Positive" is abnormal but neither high nor low; there is no directional
    // sentence to print, and inventing one would be worse than silence.
    expect(analyteFlagNote("Dengue NS1 Antigen", "ABNORMAL")).toBeNull();
  });

  it("says nothing when the analyte carries no note for that direction", () => {
    expect(analyteFlagNote("Basophils", "HIGH")).toBeNull();
    expect(analyteFlagNote("Serum Widgetase", "HIGH")).toBeNull();
  });
});

describe("analyteNote", () => {
  it("carries a non-empty description wherever it has an entry", () => {
    for (const name of ["Haemoglobin", "Platelet Count", "HbA1c", "Serum Creatinine", "Pus Cells"]) {
      expect(analyteNote(name)?.desc.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("specimenFor", () => {
  it("names what went in the tube for a catalogued test", () => {
    expect(specimenFor("CBP")).toMatch(/EDTA/);
    expect(specimenFor("LIPID")).toMatch(/fast/i);
  });

  it("accepts a lower-case code", () => {
    expect(specimenFor("urine")).toBe(specimenFor("URINE"));
  });

  it("returns null rather than guessing for an unknown or missing code", () => {
    // A walk-in test typed in by name has no catalogue code; printing a made-up
    // specimen on a report would be a lie about how the sample was taken.
    expect(specimenFor(null)).toBeNull();
    expect(specimenFor(undefined)).toBeNull();
    expect(specimenFor("NOPE")).toBeNull();
  });
});

/**
 * The band is now TWO sources: a column the lab edits and the map transcribed
 * from its report forms. Everything here is about the seam between them, and
 * the case that matters most is the one that looks like a rounding error -
 * null and "" are both falsy and mean opposite things.
 */
describe("bandFor", () => {
  it("defers to the transcribed map when the catalogue has no opinion", () => {
    // Null is what every row held the day the column was added, so this is the
    // case that decides whether adding it changed anybody's report. It did not.
    expect(bandFor(null, "CBP")).toBe("HAEMATOLOGY");
    expect(bandFor(undefined, "CBP")).toBe(departmentFor("CBP"));
  });

  it("lets the catalogue override the map", () => {
    expect(bandFor("IMMUNOLOGY", "HIV")).toBe("IMMUNOLOGY");
    // Even to something the map has never heard of - the whole point of the
    // column is that a new section does not need a developer.
    expect(bandFor("MOLECULAR", "CBP")).toBe("MOLECULAR");
  });

  it("treats an empty band as a decision, not as a missing one", () => {
    // THE CASE THE COLUMN EXISTS FOR. "" must not fall through to the map, or
    // clearing a band would come straight back as whatever the map said and the
    // one correction that prompted all this would be unsavable.
    expect(bandFor("", "CBP")).toBe("");
    expect(bandFor("", "HIV")).toBe("");
  });

  it("still answers for a test with no catalogue row at all", () => {
    // A walk-in raised by name has neither a group nor a code. Null here is
    // what makes the sheet print its LABORATORY fallback rather than a blank.
    expect(bandFor(null, null)).toBeNull();
    expect(bandFor(null, "NOPE")).toBeNull();
  });

  it("keeps the gravindex unbanded through both paths", () => {
    // Unset in the catalogue, it falls to the map - which this hospital already
    // decided prints nothing. Set to "" from the screen, same answer. The band
    // does not come back either way round.
    expect(bandFor(null, "GRAVINDEX")).toBe("");
    expect(bandFor("", "GRAVINDEX")).toBe("");
  });
});
