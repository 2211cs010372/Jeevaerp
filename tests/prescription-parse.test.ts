import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePrescriptionText, parseVitals, isEmptyParse, describeParse } from "@/lib/prescription-parse";

/**
 * The extraction that fills reception's prescription form off a scan.
 *
 * The fixture mirrors what tesseract emits for this hospital's own OPD
 * stationery - the printed labels legible, the handwriting beside them noisy,
 * table borders surviving as `|`, the Telugu dosage sub-header intact. It is a
 * reconstruction of that shape, NOT a capture from a real scan: worth knowing,
 * because the invoice parser next door earned most of its rules from real OCR
 * and this one has not been through that yet.
 *
 * What is tested hardest is not how much comes out. It is what is REFUSED. A
 * blank field sends the receptionist back to the paper; a confidently wrong
 * field does not, and this form's output goes to a pharmacy counter.
 */

const SHEET = readFileSync(join(process.cwd(), "tests/fixtures", "opd-sheet-handwritten.ocr.txt"), "utf8");

describe("vitals off the printed strip", () => {
  const v = parseVitals(SHEET);

  it("reads the BP pair", () => {
    expect(v.bpSystolic).toBe("138");
    expect(v.bpDiastolic).toBe("88");
  });

  it("reads pulse, SpO2, temp, height and weight past their printed units", () => {
    expect(v.pulse).toBe("92");
    expect(v.spo2).toBe("97");
    expect(v.tempF).toBe("99.4");
    expect(v.heightCm).toBe("168");
    expect(v.weightKg).toBe("74.5");
  });

  it("takes PR as pulse - what a lot of hands actually write", () => {
    expect(parseVitals("PR: 78").pulse).toBe("78");
  });

  it("survives the O/0 confusion in SpO2", () => {
    expect(parseVitals("Sp02 (%) 96").spo2).toBe("96");
    expect(parseVitals("SPO2: 94").spo2).toBe("94");
  });

  it("reads a BP whose slash OCR'd as a letter", () => {
    // "130/80" through a scanner is regularly "130l80" or "130I80".
    expect(parseVitals("BP (mmHg): 130l80").bpSystolic).toBe("130");
    expect(parseVitals("BP (mmHg): 130l80").bpDiastolic).toBe("80");
  });
});

describe("vitals it refuses to fill in", () => {
  // The whole point. A misread digit that lands in a field is worse than a
  // blank one, because nobody goes back to the paper for a field that is full.
  it("drops a BP that lost a digit boundary", () => {
    expect(parseVitals("BP (mmHg): 1300/80").bpSystolic).toBe("");
  });

  it("drops an impossible pulse and an impossible SpO2", () => {
    expect(parseVitals("Pulse (bpm): 920").pulse).toBe("");
    expect(parseVitals("SpO2 (%): 970").spo2).toBe("");
  });

  it("drops a temperature nothing alive has", () => {
    expect(parseVitals("Temp (°F): 994").tempF).toBe("");
    expect(parseVitals("Temp (°F): 9.4").tempF).toBe("");
  });

  it("drops a weight read off the wrong column", () => {
    expect(parseVitals("Weight (kg): 745").weightKg).toBe("");
  });

  it("drops BOTH halves when systolic isn't above diastolic", () => {
    // Either the pair was read backwards or one number is wrong. Neither
    // survives on its own, so neither is offered.
    const v = parseVitals("BP: 80/130");
    expect(v.bpSystolic).toBe("");
    expect(v.bpDiastolic).toBe("");
  });

  it("fills nothing at all from a sheet with no vitals written on it", () => {
    expect(parseVitals("Case history\nFever 3 days")).toEqual({
      bpSystolic: "", bpDiastolic: "", pulse: "", heightCm: "", weightKg: "", tempF: "", spo2: "",
    });
  });
});

describe("the medicines", () => {
  const p = parsePrescriptionText(SHEET);

  it("reads every line of the Rx table", () => {
    expect(p.medicines).toHaveLength(4);
    expect(p.medicines.map((m) => m.medicineName)).toEqual([
      "TAB DOLO 650",
      "TAB PANTOP 40",
      "SYP ASCORIL LS",
      "TAB AZITHRAL 500",
    ]);
  });

  it("splits the dosage pattern from the timing written after it", () => {
    expect(p.medicines[0].dosage).toBe("1-1-1 after food 3 days");
    expect(p.medicines[1].dosage).toBe("1-0-0 before food 5 days");
    expect(p.medicines[2].dosage).toBe("0-0-1 at bedtime");
  });

  it("takes the quantity out of the name", () => {
    expect(p.medicines[0].qty).toBe("10");
    expect(p.medicines[1].qty).toBe("5");
    expect(p.medicines[0].medicineName).not.toMatch(/10/);
  });

  it("reads a half-dose pattern", () => {
    const m = parsePrescriptionText("Rx\n1. TAB GLYCOMET 500 1/2-0-1 after food").medicines;
    expect(m[0].dosage).toBe("1/2-0-1 after food");
  });

  it("finds the lines even when the Rx heading itself didn't OCR", () => {
    // The ℞ glyph is one character and regularly comes out as nothing at all.
    const m = parsePrescriptionText("1. TAB DOLO 650 1-1-1 after food\n2. TAB PAN 40 1-0-0").medicines;
    expect(m.map((x) => x.medicineName)).toEqual(["TAB DOLO 650", "TAB PAN 40"]);
  });

  it("does not mistake the table's own column headers for a medicine", () => {
    expect(p.medicines.map((m) => m.medicineName)).not.toContain("Medicine");
    expect(p.medicines.some((m) => /timing|dosage/i.test(m.medicineName))).toBe(false);
  });

  it("drops a line with no legible drug name rather than adding a blank row", () => {
    // A blank row is one somebody has to notice and delete, and the ones that
    // get missed are sent to the pharmacy.
    const m = parsePrescriptionText("Rx\n1. ~~~ 1-0-1\n2. TAB DOLO 650 1-1-1").medicines;
    expect(m).toHaveLength(1);
    expect(m[0].medicineName).toBe("TAB DOLO 650");
  });

  it("collapses a line OCR duplicated across a rule", () => {
    const m = parsePrescriptionText("Rx\n1. TAB DOLO 650 1-1-1\n1. TAB DOLO 650 1-1-1").medicines;
    expect(m).toHaveLength(1);
  });

  it("takes the quantity even when OCR closed the gaps around it", () => {
    // Straight off a real tesseract read: "TAB DOLO 650 x 10" comes back as
    // "TABDOLO 650x10". Requiring a space before the × found no quantity at
    // all and left "650x10" sitting in the drug name.
    const m = parsePrescriptionText("Rx\n1. TABDOLO 650x10 1-1-1 after food").medicines[0];
    expect(m.qty).toBe("10");
    expect(m.medicineName).toBe("TAB DOLO 650");
  });

  it("keeps the strength and takes only the trailing count", () => {
    const m = parsePrescriptionText("Rx\n1. TAB ISTAMET 50/500 x 15 1-0-1").medicines[0];
    expect(m.medicineName).toBe("TAB ISTAMET 50/500");
    expect(m.qty).toBe("15");
  });

  it("splits the dose-form prefix OCR glued to the brand", () => {
    expect(parsePrescriptionText("Rx\n1. SYPASCORIL LS 0-0-1").medicines[0].medicineName).toBe("SYP ASCORIL LS");
    expect(parsePrescriptionText("Rx\n1. CAPOMEZ 20 1-0-0").medicines[0].medicineName).toBe("CAP OMEZ 20");
  });

  it("won't strip a count if doing so would eat the whole name", () => {
    // "X 2" alone is not a prescription line; better no medicine than a row
    // reading "2" going to a pharmacy counter.
    expect(parsePrescriptionText("Rx\n1. x 2 1-0-1").medicines).toHaveLength(0);
  });

  it("never resolves a name to a catalog id", () => {
    // Free text is the point: a misread brand silently matched to a real
    // product is how the wrong drug gets dispensed. The pharmacist matches it.
    expect(p.medicines[0]).not.toHaveProperty("medicineId");
  });
});

describe("advised tests", () => {
  const p = parsePrescriptionText(SHEET);

  it("splits the prescribed tests into separate names", () => {
    expect(p.labs).toEqual(["CBP", "CUE", "Dengue NS1 Antigen", "RBS"]);
  });

  it("splits a list written with 'and' and serial numbers", () => {
    const p2 = parsePrescriptionText("Tests prescribed: 1. CBP 2. LFT and RFT");
    expect(p2.labs).toEqual(["CBP", "LFT", "RFT"]);
  });

  it("keeps a name the lab master won't have - the doctor still asked for it", () => {
    const p2 = parsePrescriptionText("Tests advised : 2D Echo with doppler");
    expect(p2.labs).toEqual(["2D Echo with doppler"]);
  });
});

describe("the clinical lines", () => {
  const p = parsePrescriptionText(SHEET);

  it("reads the next visit", () => {
    expect(p.nextVisit).toBe("after 5 days");
  });

  it("reads the diagnosis off the heading line", () => {
    expect(p.diagnosis).toBe("Acute febrile illness with URTI");
  });

  it("reads a case history that runs over two lines", () => {
    expect(p.caseHistory).toContain("Fever 4 days");
    expect(p.caseHistory).toContain("Type 2 DM on metformin");
  });

  it("reads advice, and stops it at the next heading", () => {
    expect(p.advice).toContain("Plenty of oral fluids");
    expect(p.advice).not.toContain("after 5 days");
  });

  it("takes 'Review after' as the next visit too", () => {
    expect(parsePrescriptionText("Review after 10 days").nextVisit).toBe("10 days");
  });

  it("holds each field inside what the send endpoint accepts", () => {
    // validators/reception.ts: nextVisit 80, diagnosis 300, advice 600,
    // caseHistory 1200. Extraction must not produce something the save rejects.
    const long = parsePrescriptionText(
      `Next visit : ${"x".repeat(200)}\nDiagnosis : ${"y".repeat(500)}\nAdvice : ${"z".repeat(900)}`
    );
    expect(long.nextVisit.length).toBeLessThanOrEqual(80);
    expect(long.diagnosis.length).toBeLessThanOrEqual(300);
    expect(long.advice.length).toBeLessThanOrEqual(600);
  });
});

describe("a scan that gave nothing", () => {
  it("reports empty rather than filling the form with noise", () => {
    const p = parsePrescriptionText("~~~~ |||| .... ,,,,\n\n|| ~~");
    expect(isEmptyParse(p)).toBe(true);
    expect(p.medicines).toEqual([]);
    expect(p.labs).toEqual([]);
  });

  it("a real sheet is not empty", () => {
    expect(isEmptyParse(parsePrescriptionText(SHEET))).toBe(false);
  });
});

describe("what the desk is told", () => {
  it("tallies what was actually filled in", () => {
    const d = describeParse(parsePrescriptionText(SHEET));
    expect(d).toContain("4 medicines");
    expect(d).toContain("7 vitals");
    expect(d).toContain("4 tests");
    expect(d).toContain("next visit");
  });
});
