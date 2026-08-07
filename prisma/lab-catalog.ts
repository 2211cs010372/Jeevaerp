/**
 * THE HOSPITAL'S ACTUAL LAB MENU.
 *
 * Every entry below was transcribed from the 52 Word/RTF report templates the
 * lab prints today (Downloads/*.doc*, extracted Aug 2026). That matters more
 * than it sounds: the previous catalogue in this repo was a sensible-looking
 * set of textbook ranges that nobody here uses. A result is flagged HIGH or LOW
 * against the range stored beside it, so a range this lab does not actually
 * work to produces a report that is wrong in the one way nobody checks.
 *
 * THREE RULES FOLLOWED THROUGHOUT, ALL OF THEM DELIBERATE:
 *
 * 1. THE HOSPITAL'S NUMBERS WIN. Where a template disagrees with the textbook
 *    (SGOT "Up to 46" against the usual 5-40; platelets in Lakhs/cmm rather
 *    than /µL) the template is copied verbatim. This file is a record of what
 *    this lab does, not what a reference book says it should.
 *
 * 2. THE HOSPITAL'S UNITS WIN, spelling and all - "Gms %", "m/cmm",
 *    "Lakhs/cmm", "mm 1st hr". These print on the patient's report next to the
 *    number, and a technician proof-reading against the old paper form has to
 *    see the same words.
 *
 * 3. SEX AND AGE ARE SEPARATE ENTRIES, because the lab already keeps separate
 *    forms for them and LabAnalyte has nowhere to put a sex-specific range. A
 *    woman judged against the male haemoglobin range reads as anaemic at 12.5
 *    g/dL when she is normal, so this is not a tidiness question.
 *
 * Prices are NOT in the templates - a report form does not carry a rate. See
 * PRICE_CARRYOVER below for what happens instead.
 */

export interface AnalyteSpec {
  name: string;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  /** For results that are words, not numbers: "Negative", "Non-Reactive", "Nil". */
  refText?: string | null;
}

export interface CatalogSpec {
  code: string;
  name: string;
  /** Grouping for the ordering screen. Not stored - documentation only. */
  group: string;
  analytes: AnalyteSpec[];
}

// ─── shared building blocks ─────────────────────────────────────────────────
// The serology combinations below are the SAME four markers in thirteen
// arrangements, so they are composed rather than retyped. One template changing
// its wording must change every panel that prints it, not just the one somebody
// remembered to edit.

const HIV: AnalyteSpec = { name: "H.I.V. I & II", refText: "Negative" };
const HBSAG: AnalyteSpec = { name: "HBsAg", refText: "Negative" };
const VDRL: AnalyteSpec = { name: "VDRL", refText: "Non-Reactive" };
const HCV: AnalyteSpec = { name: "HCV", refText: "Non-Reactive" };
/** Blood group has no "normal" - the result IS the answer. Rh does. */
const BLOOD_GROUP: AnalyteSpec[] = [
  { name: "Blood Group" },
  { name: "Rh Type (D)", refText: "Positive" },
];

/**
 * The five-part differential, identical on every adult haematology form.
 *
 * The order is the bench's own reading order - neutrophils, lymphocytes,
 * eosinophils, monocytes, basophils - which is also the order the counter reads
 * them off the analyser. It is not alphabetical and not the order the old
 * templates happened to be typed in; a technician proof-reading a printed report
 * against the screen is comparing two lists line by line, and the two lists have
 * to run the same way.
 */
const DIFFERENTIAL: AnalyteSpec[] = [
  { name: "Neutrophils", unit: "%", refLow: 40, refHigh: 75 },
  { name: "Lymphocytes", unit: "%", refLow: 20, refHigh: 40 },
  { name: "Eosinophils", unit: "%", refLow: 2, refHigh: 6 },
  { name: "Monocytes", unit: "%", refLow: 2, refHigh: 8 },
  { name: "Basophils", unit: "%", refLow: 0, refHigh: 1 },
];

/**
 * The red-cell indices, in the order they are derived and read: the packed
 * volume first, then the three values calculated from it. They sit together,
 * above the differential, on every haemogram.
 */
const INDICES = (pcvLow: number, pcvHigh: number, mcvLow: number, mcvHigh: number,
  mchLow: number, mchHigh: number, mchcLow: number, mchcHigh: number): AnalyteSpec[] => [
  { name: "Haematocrit (PCV)", unit: "vol %", refLow: pcvLow, refHigh: pcvHigh },
  { name: "M.C.V", unit: "fl", refLow: mcvLow, refHigh: mcvHigh },
  { name: "M.C.H", unit: "pg", refLow: mchLow, refHigh: mchHigh },
  { name: "M.C.H.C", unit: "%", refLow: mchcLow, refHigh: mchcHigh },
];

/** The free-text smear comment that closes every blood picture report. */
const SMEAR: AnalyteSpec = { name: "Blood Picture", refText: "Normocytic and Normochromic" };

const PLATELETS: AnalyteSpec = { name: "Platelet Count", unit: "Lakhs/cmm", refLow: 1.5, refHigh: 4.5 };

const AEC: AnalyteSpec = { name: "A.E.C", unit: "Cells/cmm", refLow: 40, refHigh: 440 };

const RETICULOCYTES: AnalyteSpec = { name: "Reticulocyte Count", unit: "%", refLow: 0.2, refHigh: 2 };

/**
 * Random blood sugar, shared by every form that asks for one.
 *
 * It appears on the standalone glucometer test, on the renal panel, and on both
 * profiles. Composed rather than retyped for the reason the serology markers
 * are: the same analyte flagged against two different ranges on two forms from
 * the same sample is the bug this file exists to prevent.
 */
const RANDOM_SUGAR: AnalyteSpec = { name: "Random Blood Sugar", unit: "mg/dl", refLow: 70, refHigh: 160 };

/** Bleeding and clotting time, as the BT-CT form and both profiles carry them. */
const BLEEDING_TIME: AnalyteSpec = { name: "Bleeding Time", unit: "Minutes", refLow: 1, refHigh: 3 };
const CLOTTING_TIME: AnalyteSpec = { name: "Clotting Time", unit: "Minutes", refLow: 3, refHigh: 9 };

/** Every sugar form asks for it, and it is dashed out as often as filled in. */
const URINE_SUGAR: AnalyteSpec = { name: "Corresponding Urine Sugar", refText: "Nil" };

export const LAB_CATALOG: CatalogSpec[] = [
  // ══ HAEMATOLOGY ═══════════════════════════════════════════════════════════
  {
    code: "CBP-M",
    name: "Complete Blood Picture (Male)",
    group: "Haematology",
    analytes: [
      { name: "Total WBC Count", unit: "/cmm", refLow: 4000, refHigh: 11000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 13, refHigh: 18 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 4.5, refHigh: 5.5 },
      PLATELETS,
      ...DIFFERENTIAL,
      SMEAR,
    ],
  },
  {
    code: "CBP-F",
    name: "Complete Blood Picture (Female)",
    group: "Haematology",
    analytes: [
      // The form also prints "4000 - 13000 in pregnancy". LabAnalyte holds ONE
      // range, so the non-pregnant range is stored and the pregnancy note stays
      // on the printed form where the pathologist reads it in context.
      { name: "Total WBC Count", unit: "/cmm", refLow: 4000, refHigh: 11000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 12, refHigh: 16 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 3.8, refHigh: 4.8 },
      PLATELETS,
      ...DIFFERENTIAL,
      SMEAR,
    ],
  },
  {
    code: "CBP-F-AEC",
    name: "Complete Blood Picture with AEC (Female)",
    group: "Haematology",
    analytes: [
      { name: "Total WBC Count", unit: "/cmm", refLow: 4000, refHigh: 11000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 12, refHigh: 16 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 3.8, refHigh: 4.8 },
      PLATELETS,
      ...DIFFERENTIAL,
      AEC,
      SMEAR,
    ],
  },
  {
    // The male haemogram has no template of its own - the lab has only ever
    // printed the female and paediatric forms - so it is composed from the male
    // ranges the CBP (Male) form DOES carry. The one number with no source is
    // the haematocrit: 40-50 vol % is the standard adult male band, and it is
    // FLAGGED FOR THE PATHOLOGIST as the row to confirm before go-live.
    code: "HAEMOGRAM-M",
    name: "Haemogram (Male)",
    group: "Haematology",
    analytes: [
      { name: "Total WBC Count", unit: "/cmm", refLow: 4000, refHigh: 11000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 13, refHigh: 18 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 4.5, refHigh: 5.5 },
      PLATELETS,
      ...INDICES(40, 50, 80, 95, 27, 32, 32, 36),
      ...DIFFERENTIAL,
      RETICULOCYTES,
      SMEAR,
    ],
  },
  {
    code: "HAEMOGRAM-F",
    name: "Haemogram (Female)",
    group: "Haematology",
    analytes: [
      { name: "Total WBC Count", unit: "/cmm", refLow: 4000, refHigh: 11000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 12, refHigh: 16 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 3.8, refHigh: 4.8 },
      PLATELETS,
      ...INDICES(36, 46, 80, 95, 27, 32, 32, 36),
      ...DIFFERENTIAL,
      RETICULOCYTES,
      SMEAR,
    ],
  },
  {
    code: "HAEMOGRAM-PED",
    name: "Haemogram (2 - 6 years)",
    group: "Haematology",
    analytes: [
      { name: "Total WBC Count", unit: "/cmm", refLow: 5000, refHigh: 15000 },
      { name: "Haemoglobin", unit: "Gms %", refLow: 11, refHigh: 14 },
      { name: "Total RBC Count", unit: "m/cmm", refLow: 4.0, refHigh: 5.2 },
      PLATELETS,
      ...INDICES(34, 40, 75, 87, 24, 30, 31, 37),
      // The paediatric form prints no differential ranges of its own, so the
      // adult ones are carried across unchanged. FLAGGED FOR THE PATHOLOGIST:
      // paediatric lymphocyte counts run higher than adult, and these five rows
      // are the ones to check before this goes live.
      ...DIFFERENTIAL,
      RETICULOCYTES,
      { name: "E.S.R", unit: "mm 1st hr", refLow: 5, refHigh: 15 },
      SMEAR,
    ],
  },
  {
    code: "HB-M",
    name: "Haemoglobin (Male)",
    group: "Haematology",
    analytes: [{ name: "Haemoglobin", unit: "Gms %", refLow: 13, refHigh: 18 }],
  },
  {
    code: "HB-F",
    name: "Haemoglobin (Female)",
    group: "Haematology",
    analytes: [{ name: "Haemoglobin", unit: "Gms %", refLow: 12, refHigh: 16 }],
  },
  {
    // The HB% form carries the full paediatric ladder. Each band is its own row
    // so the bench fills the one matching the child and leaves the rest blank -
    // the alternative is judging a 3-day-old against an adult range, which
    // flags every healthy newborn.
    code: "HB-PED",
    name: "Haemoglobin (Paediatric age bands)",
    group: "Haematology",
    analytes: [
      { name: "Haemoglobin (Birth - 2 Days)", unit: "Gms %", refLow: 14.0, refHigh: 22.0 },
      { name: "Haemoglobin (3 Days - 1 Month)", unit: "Gms %", refLow: 15.0, refHigh: 21.0 },
      { name: "Haemoglobin (1 - 2 Months)", unit: "Gms %", refLow: 11.5, refHigh: 16.5 },
      { name: "Haemoglobin (2 - 3 Months)", unit: "Gms %", refLow: 9.4, refHigh: 13.0 },
      { name: "Haemoglobin (3 Months - 2 Years)", unit: "Gms %", refLow: 11.1, refHigh: 14.1 },
      { name: "Haemoglobin (2 - 6 Years)", unit: "Gms %", refLow: 11.0, refHigh: 14.0 },
      { name: "Haemoglobin (6 - 12 Years)", unit: "Gms %", refLow: 11.5, refHigh: 15.5 },
    ],
  },
  {
    code: "ESR",
    name: "E.S.R",
    group: "Haematology",
    analytes: [{ name: "E.S.R", unit: "mm 1st hr", refLow: 5, refHigh: 15 }],
  },
  {
    // Asked for on its own often enough to be its own line on the order form -
    // a dengue or fever follow-up wants the count and nothing else, and
    // ordering a whole CBP to get it bills the patient for work nobody reads.
    code: "PLT",
    name: "Platelet Count",
    group: "Haematology",
    analytes: [PLATELETS],
  },
  {
    code: "AEC",
    name: "Absolute Eosinophil Count (AEC)",
    group: "Haematology",
    analytes: [AEC],
  },
  {
    code: "RETIC",
    name: "Reticulocyte Count",
    group: "Haematology",
    analytes: [RETICULOCYTES],
  },
  {
    code: "BTCT",
    name: "Bleeding Time & Clotting Time (BT-CT)",
    group: "Haematology",
    analytes: [BLEEDING_TIME, CLOTTING_TIME],
  },
  {
    code: "PS",
    name: "Peripheral Smear (Blood Picture)",
    group: "Haematology",
    analytes: [
      { name: "RBC Morphology", refText: "Normocytic and Normochromic" },
      { name: "WBC", refText: "WBC's are normal in count and differentials" },
      { name: "Platelets", refText: "Platelets are adequate on smear" },
      { name: "Impression" },
    ],
  },

  // ══ BLOOD BANKING ═════════════════════════════════════════════════════════
  {
    code: "BG",
    name: "Blood Grouping & Rh Typing",
    group: "Blood Banking",
    analytes: BLOOD_GROUP,
  },
  {
    // The Rh-negative form adds the Du (weak-D) confirmation, which is the
    // whole reason it is a separate template: a Du-positive mother must not be
    // treated as Rh negative.
    code: "BG-DU",
    name: "Blood Grouping & Rh Typing with Du",
    group: "Blood Banking",
    analytes: [...BLOOD_GROUP, { name: "Du (Weak D)", refText: "Negative" }],
  },

  // ══ BLOOD SUGAR ═══════════════════════════════════════════════════════════
  {
    code: "FBS",
    name: "Fasting Blood Sugar (FBS)",
    group: "Blood Sugar",
    analytes: [
      { name: "Fasting Blood Sugar", unit: "mg/dl", refLow: 60, refHigh: 110 },
      URINE_SUGAR,
    ],
  },
  {
    code: "PLBS",
    name: "Post Lunch Blood Sugar (PLBS)",
    group: "Blood Sugar",
    analytes: [
      { name: "Post Lunch Blood Sugar", unit: "mg/dl", refLow: 110, refHigh: 170 },
      URINE_SUGAR,
    ],
  },
  {
    code: "FBS-PLBS",
    name: "Blood Sugar - Fasting & Post Lunch",
    group: "Blood Sugar",
    analytes: [
      { name: "Fasting Blood Sugar", unit: "mg/dl", refLow: 60, refHigh: 110 },
      { name: "Corresponding Urine Sugar (Fasting)", refText: "Nil" },
      { name: "Post Lunch Blood Sugar", unit: "mg/dl", refLow: 110, refHigh: 170 },
      { name: "Corresponding Urine Sugar (Post Lunch)", refText: "Nil" },
    ],
  },
  {
    code: "RBS",
    name: "Random Blood Sugar (RBS)",
    group: "Blood Sugar",
    analytes: [RANDOM_SUGAR],
  },
  {
    code: "GTT",
    name: "Glucose Tolerance Test (GTT)",
    group: "Blood Sugar",
    analytes: [
      { name: "Fasting Plasma Glucose", unit: "mg/dl", refLow: 60, refHigh: 110 },
      { name: "Urine Sugar (Fasting)", refText: "Nil" },
      { name: "1st Hour Plasma Glucose", unit: "mg/dl", refLow: 60, refHigh: 180 },
      { name: "Urine Sugar (1st Hour)", refText: "Nil" },
      { name: "2nd Hour Plasma Glucose", unit: "mg/dl", refLow: 60, refHigh: 140 },
      { name: "Urine Sugar (2nd Hour)", refText: "Nil" },
    ],
  },

  // ══ BIOCHEMISTRY ══════════════════════════════════════════════════════════
  {
    code: "UREA",
    name: "Blood Urea",
    group: "Biochemistry",
    analytes: [{ name: "Blood Urea", unit: "mg/dl", refLow: 10, refHigh: 45 }],
  },
  {
    // "Serum Creatinine & RBS" is GONE. It was a pairing of two unrelated
    // assays that existed because the old form printed them on one page; both
    // now stand on their own - creatinine under RFT below, the sugar under RBS -
    // and the seed retires the old code rather than deleting it, so the reports
    // already printed against it stay readable.
    code: "RFT",
    name: "Renal Function Tests (RFT)",
    group: "Biochemistry",
    analytes: [
      { name: "Serum Creatinine", unit: "mg/dl", refLow: 0.6, refHigh: 1.3 },
      { name: "Blood Urea", unit: "mg/dl", refLow: 10, refHigh: 45 },
      RANDOM_SUGAR,
      // The RFT form prints both sexes' uric acid ranges side by side. Two rows,
      // so whichever is filled is judged against the right one.
      { name: "Serum Uric Acid (Male)", unit: "mg/dl", refLow: 3.5, refHigh: 7.2 },
      { name: "Serum Uric Acid (Female)", unit: "mg/dl", refLow: 2.5, refHigh: 6.2 },
    ],
  },
  {
    code: "LFT",
    name: "Liver Function Test (LFT)",
    group: "Biochemistry",
    analytes: [
      { name: "Total Bilirubin", unit: "mg/dl", refLow: 0.1, refHigh: 1.2 },
      { name: "Direct Bilirubin", unit: "mg/dl", refLow: 0.0, refHigh: 0.3 },
      { name: "Indirect Bilirubin", unit: "mg/dl", refLow: 0.1, refHigh: 1.0 },
      // "Up - 46" on the form: an upper bound with no floor.
      { name: "S.G.O.T", unit: "U/L", refLow: 0, refHigh: 46 },
      { name: "S.G.P.T", unit: "U/L", refLow: 0, refHigh: 49 },
      { name: "Serum Alkaline Phosphatase", unit: "U/L", refLow: 64, refHigh: 306 },
    ],
  },
  {
    code: "BILIRUBIN",
    name: "Serum Bilirubin",
    group: "Biochemistry",
    analytes: [
      // Adult and infant split for the same reason as the haemoglobin ladder:
      // a healthy 3-day-old sits where an adult would be in liver failure.
      //
      // The infant row is NAMED, not indented. It was transcribed off the form
      // as sixteen spaces and "(Infants)", which is how the paper indents it
      // under the line above - but on screen and in the results table that
      // prints as a row with no name on it, and a range with nothing to say
      // what it is a range OF is worse than a lost indent.
      { name: "Total Bilirubin (Adults)", unit: "mg/dl", refLow: 0.1, refHigh: 1.2 },
      { name: "Total Bilirubin (Infants)", unit: "mg/dl", refLow: 1.2, refHigh: 12 },
      { name: "Direct Bilirubin", unit: "mg/dl", refLow: 0.0, refHigh: 0.3 },
      { name: "Indirect Bilirubin", unit: "mg/dl", refLow: 0.1, refHigh: 1.0 },
    ],
  },
  {
    code: "LIPID",
    name: "Lipid Profile (LP)",
    group: "Biochemistry",
    analytes: [
      { name: "Cholesterol", unit: "mg/dL", refLow: 0, refHigh: 250 },
      { name: "HDL Cholesterol (Male)", unit: "mg/dL", refLow: 30, refHigh: 65 },
      { name: "HDL Cholesterol (Female)", unit: "mg/dL", refLow: 35, refHigh: 75 },
      { name: "Triglycerides", unit: "mg/dL", refLow: 0, refHigh: 150 },
      { name: "LDL Cholesterol", unit: "mg/dL", refLow: 0, refHigh: 100 },
      { name: "VLDL", unit: "mg/dL", refLow: 0, refHigh: 30 },
      // The form prints a four-band risk scale for these. A single normal band
      // is stored so the flag means something; the full scale stays on the
      // printed report, where the risk wording belongs.
      { name: "Total Cholesterol / HDL Ratio", refLow: 3.3, refHigh: 4.4 },
      { name: "LDL Cholesterol / HDL Ratio", refLow: 0.5, refHigh: 3.0 },
    ],
  },
  {
    code: "CALCIUM",
    name: "Serum Calcium",
    group: "Biochemistry",
    analytes: [{ name: "Calcium", unit: "mg/dl", refLow: 8.5, refHigh: 11.0 }],
  },
  {
    code: "URIC",
    name: "Serum Uric Acid",
    group: "Biochemistry",
    analytes: [
      { name: "Serum Uric Acid (Male)", unit: "mg/dl", refLow: 3.4, refHigh: 7.0 },
      { name: "Serum Uric Acid (Female)", unit: "mg/dl", refLow: 2.4, refHigh: 5.7 },
    ],
  },
  {
    code: "PROTEIN",
    name: "Total Protein Estimation",
    group: "Biochemistry",
    analytes: [
      { name: "Total Protein", unit: "g/dl", refLow: 6.0, refHigh: 8.3 },
      { name: "Albumin", unit: "g/dl", refLow: 3.2, refHigh: 5.0 },
      { name: "Globulin", unit: "g/dl", refLow: 2.3, refHigh: 3.6 },
      { name: "A/G Ratio", refText: "2 : 1" },
    ],
  },
  {
    code: "ELECTROLYTES",
    name: "Serum Electrolytes",
    group: "Biochemistry",
    analytes: [
      { name: "Sodium", unit: "mEq/L", refLow: 135, refHigh: 155 },
      { name: "Potassium", unit: "mEq/L", refLow: 3.5, refHigh: 5.5 },
      { name: "Calcium", unit: "mg/dl", refLow: 8.5, refHigh: 11.0 },
    ],
  },
  {
    code: "AMYLASE",
    name: "Serum Amylase",
    group: "Biochemistry",
    analytes: [{ name: "Serum Amylase", unit: "IU/L", refLow: 35, refHigh: 80 }],
  },

  // ══ SEROLOGY ══════════════════════════════════════════════════════════════
  // The thirteen combinations below are how this lab actually sells the work:
  // one form, one fee, one signature. Composed from the shared markers above.
  { code: "HIV", name: "H.I.V. I & II Screening", group: "Serology", analytes: [HIV] },
  { code: "HBSAG", name: "HBsAg", group: "Serology", analytes: [HBSAG] },
  // HCV used to exist only inside the four-marker panel, so a doctor who wanted
  // hepatitis C alone had to order - and the patient had to pay for - three
  // markers they hadn't asked for.
  { code: "HCV", name: "H.C.V", group: "Serology", analytes: [HCV] },
  // The three viral markers a pre-operative or pre-transfusion screen actually
  // asks for, on one form and one fee. VDRL is deliberately not in it: the
  // panels that want syphilis are the ones already listed below.
  { code: "HIV-HBSAG-HCV", name: "HIV, HBsAg, HCV", group: "Serology", analytes: [HIV, HBSAG, HCV] },
  { code: "HIV-VDRL", name: "HIV, VDRL", group: "Serology", analytes: [HIV, VDRL] },
  { code: "HIV-BG", name: "HIV, Blood Group", group: "Serology", analytes: [HIV, ...BLOOD_GROUP] },
  { code: "HIV-HBSAG", name: "HIV, HBsAg", group: "Serology", analytes: [HIV, HBSAG] },
  { code: "HBSAG-BG", name: "HBsAg, Blood Group", group: "Serology", analytes: [HBSAG, ...BLOOD_GROUP] },
  { code: "HBSAG-VDRL", name: "HBsAg, VDRL", group: "Serology", analytes: [HBSAG, VDRL] },
  { code: "HIV-VDRL-BG", name: "HIV, VDRL, Blood Group", group: "Serology", analytes: [HIV, VDRL, ...BLOOD_GROUP] },
  { code: "HIV-HBSAG-BG", name: "HIV, HBsAg, Blood Group", group: "Serology", analytes: [HIV, HBSAG, ...BLOOD_GROUP] },
  { code: "HBSAG-VDRL-BG", name: "HBsAg, VDRL, Blood Group", group: "Serology", analytes: [HBSAG, VDRL, ...BLOOD_GROUP] },
  { code: "HIV-HBSAG-VDRL", name: "HIV, HBsAg, VDRL", group: "Serology", analytes: [HIV, HBSAG, VDRL] },
  { code: "HIV-HBSAG-VDRL-BG", name: "HIV, HBsAg, VDRL, Blood Group", group: "Serology", analytes: [HIV, HBSAG, VDRL, ...BLOOD_GROUP] },
  { code: "HIV-HBSAG-VDRL-HCV", name: "HIV, HBsAg, VDRL, HCV", group: "Serology", analytes: [HIV, HBSAG, VDRL, HCV] },
  {
    code: "WIDAL",
    name: "Widal Test",
    group: "Serology",
    analytes: [
      { name: "Salmonella Typhi 'O' Agglutination", refText: "1 : 20 Dilutions" },
      { name: "Salmonella Typhi 'H' Agglutination", refText: "1 : 20 Dilutions" },
      { name: "Salmonella Para Typhi 'AH' Agglutination", refText: "1 : 20 Dilutions" },
      { name: "Salmonella Para Typhi 'BH' Agglutination", refText: "1 : 20 Dilutions" },
      { name: "Result", refText: "Negative" },
    ],
  },
  {
    code: "DENGUE",
    name: "Dengue Check (NS1, IgM, IgG)",
    group: "Serology",
    analytes: [
      { name: "Dengue Check NS1", refText: "Negative" },
      { name: "Dengue Check IgM", refText: "Negative" },
      { name: "Dengue Check IgG", refText: "Negative" },
    ],
  },
  {
    code: "GRAVINDEX",
    name: "Gravindex Test (Urine Pregnancy)",
    group: "Serology",
    analytes: [
      // "Positive" is the hospital's own wording for this row, and it prints in
      // the reference column as given. It costs nothing to be wrong about:
      // nothing on this sheet grades a pregnancy, because text results are only
      // ever marked abnormal by hand (see flagFor in labs.service.ts). The
      // column is a printed prompt here, not a threshold.
      { name: "Urine For Gravindex", refText: "Positive" },
    ],
  },
  {
    code: "CRP",
    name: "C-Reactive Protein (CRP)",
    group: "Serology",
    analytes: [{ name: "C-Reactive Protein", unit: "mg/L", refLow: 0.0, refHigh: 6.0 }],
  },
  {
    code: "RAF",
    name: "Rheumatoid Factor (RA Factor)",
    group: "Serology",
    analytes: [{ name: "Rheumatoid Factor", unit: "IU/ml", refText: "Non-Reactive" }],
  },
  {
    code: "MP-PF-PV",
    name: "Malarial Parasite (PF, PV)",
    group: "Serology",
    analytes: [
      { name: "Plasmodium Vivax", refText: "Negative" },
      { name: "Plasmodium Falciparum", refText: "Negative" },
    ],
  },
  {
    code: "MP-PF-PAN",
    name: "Malarial Parasite (PAN, PF)",
    group: "Serology",
    analytes: [
      { name: "PAN [Other species (non falciparum)]", refText: "Negative" },
      { name: "Plasmodium Falciparum", refText: "Negative" },
    ],
  },
  {
    code: "MONTOUX",
    name: "Montoux Test",
    group: "Serology",
    analytes: [
      { name: "Induration", unit: "mm" },
      { name: "Erythema", refText: "Not seen" },
      // Doubtful is a real third outcome on this form, not an error state.
      { name: "Result", refText: "Negative" },
    ],
  },

  // ══ CLINICAL PATHOLOGY ════════════════════════════════════════════════════
  {
    code: "CUE",
    name: "Complete Urine Examination (CUE)",
    group: "Clinical Pathology",
    analytes: [
      { name: "Colour", refText: "Pale Yellow" },
      { name: "Reaction", refText: "Acidic" },
      { name: "Appearance", refText: "Clear" },
      { name: "SP - Gravity", refText: "1:015" },
      { name: "Sugar", refText: "Nil" },
      { name: "Albumin", refText: "Nil" },
      { name: "Ketone Bodies", refText: "Negative" },
      { name: "Urobilinogen", refText: "Normal" },
      { name: "Bile Salts", refText: "Negative" },
      { name: "Bile Pigments", refText: "Negative" },
      { name: "R.B.C", unit: "hpf", refText: "Nil" },
      { name: "Pus Cells", unit: "hpf", refText: "0 - 5" },
      { name: "Epithelial Cells", unit: "hpf", refText: "0 - 5" },
      { name: "Casts", unit: "hpf", refText: "Nil" },
      { name: "Crystals", unit: "hpf", refText: "Nil" },
      { name: "Parasite", unit: "hpf", refText: "Nil" },
      { name: "Mucous threads", refText: "Nil" },
      { name: "Bacteria", unit: "hpf", refText: "Nil" },
      { name: "Others", refText: "Nil" },
    ],
  },
  {
    code: "FLUID",
    name: "Fluid Analysis",
    group: "Clinical Pathology",
    analytes: [
      { name: "Fluid" },
      { name: "Colour", refText: "Pale Yellow" },
      { name: "Quantity", unit: "ml" },
      { name: "Appearance", refText: "Clear" },
      { name: "Clots", refText: "Absent" },
      { name: "Total Count", unit: "cells/cu.mm" },
      { name: "Polymorphs", unit: "%" },
      { name: "Lymphocytes", unit: "%" },
      { name: "Mesothelial cells", unit: "%" },
      { name: "Red cells" },
      { name: "Proteins", unit: "gm/dl" },
      { name: "Sugar", unit: "mg/dl" },
    ],
  },
  {
    // The source file is the pre-test QUESTIONNAIRE, not a result form - it has
    // no analytes or ranges on it at all. The rows below are the WHO semen
    // parameters this test must report; the pathologist confirms them against
    // their own result form before this is used. See docs note in the seed.
    code: "SEMEN",
    name: "Semen Analysis",
    group: "Clinical Pathology",
    analytes: [
      { name: "Abstinence Period", unit: "days" },
      { name: "Method of Collection", refText: "Masturbation" },
      { name: "Volume", unit: "ml" },
      { name: "Colour" },
      { name: "Liquefaction Time", unit: "minutes" },
      { name: "Total Sperm Count", unit: "million/ml" },
      { name: "Motility (Active)", unit: "%" },
      { name: "Motility (Sluggish)", unit: "%" },
      { name: "Non-motile", unit: "%" },
      { name: "Abnormal Forms", unit: "%" },
      { name: "Pus Cells", unit: "hpf" },
      { name: "Impression" },
    ],
  },

  // ══ PROFILES ══════════════════════════════════════════════════════════════
  {
    code: "ANTENATAL",
    name: "Antenatal Profile",
    group: "Profiles",
    analytes: [
      RANDOM_SUGAR,
      { name: "Blood Urea", unit: "mg/dl", refLow: 10, refHigh: 45 },
      { name: "Bleeding Time (BT)", unit: "Minutes", refLow: 1, refHigh: 3 },
      { name: "Clotting Time (CT)", unit: "Minutes", refLow: 3, refHigh: 7 },
      ...BLOOD_GROUP,
      HBSAG,
      HIV,
      { name: "VDRL", refText: "Non - Reactive" },
    ],
  },
  {
    // What a surgeon wants back before a list: can this patient clot, what is
    // their group if they need blood, are they carrying anything the theatre
    // team must know about, and where is their sugar. One form, one fee.
    code: "SURGICAL",
    name: "Surgical Profile",
    group: "Profiles",
    analytes: [
      BLEEDING_TIME,
      CLOTTING_TIME,
      ...BLOOD_GROUP,
      HIV,
      HBSAG,
      HCV,
      RANDOM_SUGAR,
    ],
  },
];

/**
 * Canned peripheral-smear comments, transcribed from "Blood picture.docx".
 *
 * That file is not a test - it is the phrase book the bench picks from so two
 * technicians describe the same slide the same way. Exported here because it
 * came out of the same batch and is worth keeping next to the catalogue; it is
 * NOT seeded into any table. Wiring it into the results screen as a dropdown is
 * a separate, small piece of work.
 */
export const SMEAR_PHRASES = {
  rbc: [
    "Normocytic and Normochromic.",
    "Normocytic and Hypochromic.",
    "Normocytic and Mild Hypochromic.",
    "Normocytic and Normochromic anaemia.",
    "Normocytic and Hypochromic anaemia.",
    "Macrocytic and Normochromic.",
    "Microcytic and hypochromic anaemia.",
    "RBC'S Show Dimorphic Anaemia",
    "RBC's show SICKLE CELLS, NORMOBLASTS",
  ],
  wbc: [
    "WBC's are normal in count and differentials.",
    "WBC's are normal in count with neutrophilia.",
    "WBC's are normal in count with neutrophilic predominence.",
    "WBC's are normal in count with relative neutrophilia.",
    "WBC's are normal in count with relative neutrophilic predominence.",
    "WBC's are normal in count with lymphocytic prominence.",
    "WBC's are normal in count with mild lymphocytic predominence.",
    "WBC's are normal in count with lymphocytic predominence.",
    "WBC's are normal in count with lymphocytosis.",
    "WBC's are normal in count with lymphocytic predominance and eosinophilia.",
    "WBC's are normal in count with eosinophilia.",
    "WBC's are normal in count with eosinophilic prominence.",
    "WBC's show leucocytosis with normal differentials.",
    "WBC's show mild leucocytosis with normal differentials.",
    "WBC's show lymphocytic leucocytosis.",
    "WBC's show eosinophilic leucocytosis.",
    "WBC's show leucopenia with normal differentials.",
    "WBC's show mild leucopenia with normal differentials.",
    "WBC's show leucopenia with neutrophilia.",
    "WBC's show mild leucopenia with neutrophilic prominence.",
    "WBC's show leucopenia with relative neutrophilic prominence.",
    "WBC's show leucopenia with lymphocytic prominence.",
    "WBC's show mild leucopenia with mild lymphocytic prominence.",
    "WBC's show leucopenia with relative lymphocytic prominence.",
  ],
  platelets: [
    "Platelets are adequate on smear.",
    "Platelets show thrombocytosis.",
    "Platelets show mild thrombocytopenia.",
    "Platelets show thrombocytopenia.",
    "Platelets reduced.",
  ],
  advice: [
    "Advise : - Repeat the test after one week with early morning sample.",
    "** Delayed positive (after 5 mts)",
    "HEMOLYTIC ANAEMIA.",
    "Advise:- 1.SICKLING TEST  2.Hb ELECTROPHORESIS",
  ],
} as const;

/**
 * Prices are not on a report form, so the old catalogue's rates are carried
 * across wherever the same test survived the rewrite. Everything else lands at
 * ZERO and the seed prints it in a list the hospital has to work through in
 * Admin -> Catalog before go-live.
 *
 * Zero rather than a guess: an invented rate is indistinguishable on screen
 * from a real one and would be billed to a patient without anybody noticing.
 * A zero is obviously wrong to whoever looks at the ordering screen.
 */
export const PRICE_CARRYOVER: Record<string, string> = {
  "CBP-M": "CBP", "CBP-F": "CBP", "CBP-F-AEC": "CBP",
  "HAEMOGRAM-M": "CBP", "HAEMOGRAM-F": "CBP", "HAEMOGRAM-PED": "CBP",
  FBS: "FBS", PLBS: "PPBS", RBS: "RBS",
  LIPID: "LIPID", LFT: "LFT", BILIRUBIN: "BILIRUBIN",
  RFT: "KFT", URIC: "URIC",
  AMYLASE: "AMYLASE", CRP: "CRP", ESR: "ESR", RAF: "RAF",
  CUE: "URINE", DENGUE: "DENGUE", WIDAL: "WIDAL",
};
