/**
 * Analyte reference notes - the plain-language line printed under each analyte
 * on the lab report.
 *
 * A report that says "MCHC 30.2 g/dL  32 - 36" tells a doctor everything and a
 * patient nothing. The hospital hands these sheets to the patient at the
 * counter, and the question at the counter is always the same one: "what is
 * this?". So each analyte carries a one-line description of WHAT IS MEASURED,
 * and - for the values a range can actually be crossed on - a short note on what
 * a high or a low reading usually points at.
 *
 * DELIBERATELY NOT IN THE DATABASE. Three reasons:
 *
 *  1. It is not evidence. LabResultItem snapshots name, unit and range because
 *     those are what the result was JUDGED against and a later catalogue edit
 *     must never re-grade a report already in a patient's hand. A description is
 *     explanatory prose about the analyte itself - correcting a clumsy sentence
 *     should improve every report ever printed, not fork them.
 *  2. It works retroactively. Every result already saved gets its notes the
 *     moment this file lands; nothing has to be re-entered or back-filled.
 *  3. It is keyed by analyte NAME, not by catalogue id, so a value typed in by
 *     hand on the "Add a line" row picks up the same note as one that came from
 *     the seeded template.
 *
 * These are general reference notes, not an interpretation of a particular
 * patient's result - the sheet says so in print, under the table. What this
 * result means for this person is the treating doctor's call, and the lab's own
 * read of the specimen goes in LabTest.impression, in the technician's words.
 */

export interface AnalyteNote {
  /** What the analyte measures. One line, printed under the name. */
  desc: string;
  /** What a value above the reference range commonly points at. */
  high?: string;
  /** What a value below it commonly points at. */
  low?: string;
}

/**
 * Normalised lookup key: case, spaces and punctuation all thrown away, so
 * "PCV (Haematocrit)", "pcv haematocrit" and "PCV(HAEMATOCRIT)" are one entry.
 */
const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Old analyte name -> the note key it still belongs to.
 *
 * The catalogue was rewritten from the hospital's own 52 report forms, which
 * name things the way the bench says them: "S.G.O.T", not "SGOT (AST)". The
 * notes below were keyed to the previous spellings, and a note that no longer
 * matches does not error - it silently prints a blanker report, which is the
 * failure mode nobody notices.
 *
 * BOTH spellings have to resolve, permanently. Results already reported are
 * stored on LabResultItem with the name as it was THEN, and re-opening a March
 * report re-renders from those rows. Dropping the old keys would quietly strip
 * the explanations off every report printed before the rewrite.
 */
const ALIASES: Record<string, string> = {
  // ── haematology ──
  totalrbccount: "rbccount",
  haematocritpcv: "pcvhaematocrit",
  // ── liver ──
  sgot: "sgotast",
  sgpt: "sgptalt",
  serumalkalinephosphatase: "alkalinephosphatase",
  totalbilirubinadults: "totalbilirubinadult",
  // ── renal ──
  serumuricacidmale: "uricacidmale",
  serumuricacidfemale: "uricacidfemale",
  serumuricacid: "uricacid",
  // ── lipids ──
  cholesterol: "totalcholesterol",
  hdlcholesterolmale: "hdlcholesterol",
  hdlcholesterolfemale: "hdlcholesterol",
  vldl: "vldlcholesterol",
  // ── sugars ──
  fastingbloodsugar: "glucosefasting",
  fastingplasmaglucose: "glucosefasting",
  postlunchbloodsugar: "glucosepostprandial",
  // ── serology ──
  denguecheckns1: "denguens1antigen",
  denguecheckigm: "dengueigm",
  denguecheckigg: "dengueigg",
  rheumatoidfactor: "rafactor",
  salmonellatyphioagglutination: "styphio",
  salmonellatyphihagglutination: "styphih",
  salmonellaparatyphiahagglutination: "sparatyphiah",
  salmonellaparatyphibhagglutination: "sparatyphibh",
  // ── urine ──
  rbc: "rbcs",
  spgravity: "specificgravity",
  sugar: "glucose",
  albumin: "proteinalbumin",
};

/** Normalise, then follow an alias if the name was spelled the older way. */
const resolve = (name: string): string => {
  const k = key(name);
  return ALIASES[k] ?? k;
};

/**
 * Keyed by analyte name as the templates and the bench actually type it.
 * Grouped by the panel they belong to, in the order seed-lab-analytes.ts lists
 * them - so adding an analyte to a template and adding its note here is one
 * scroll through two files that read the same way.
 */
const NOTES: Record<string, AnalyteNote> = {
  // ── Complete blood picture ──
  haemoglobin: {
    desc: "Oxygen-carrying pigment of the red cells.",
    high: "Seen with dehydration, smoking or living at altitude.",
    low: "Anaemia - iron, B12 or folate deficiency, or blood loss.",
  },
  totalwbccount: {
    desc: "White cells, the body's infection-fighting cells.",
    high: "Usually a bacterial infection, inflammation or stress.",
    low: "Viral illness, some medicines, or marrow suppression.",
  },
  plateletcount: {
    desc: "Cell fragments that clot the blood and stop bleeding.",
    high: "Reactive to infection, inflammation or iron deficiency.",
    low: "Dengue and other viral fevers, or a marrow cause - watch for bleeding.",
  },
  rbccount: {
    desc: "Number of red cells carrying the haemoglobin.",
    low: "Anaemia; read together with haemoglobin and PCV.",
  },
  pcvhaematocrit: {
    desc: "Share of blood volume made up of red cells.",
    high: "Dehydration - the cells are concentrated, not increased.",
    low: "Anaemia or fluid overload.",
  },
  mcv: {
    desc: "Average size of a red cell - the first clue to the type of anaemia.",
    high: "Large cells: B12 or folate deficiency.",
    low: "Small cells: iron deficiency or thalassaemia trait.",
  },
  mch: {
    desc: "Average weight of haemoglobin inside one red cell.",
    low: "Pale, under-filled cells - typically iron deficiency.",
  },
  mchc: {
    desc: "Haemoglobin concentration within the red cells.",
    low: "Hypochromia, the classic iron-deficiency picture.",
  },
  neutrophils: {
    desc: "The white cells that answer bacterial infection first.",
    high: "Bacterial infection, inflammation or steroid use.",
    low: "Some viral infections and marrow suppression.",
  },
  lymphocytes: {
    desc: "White cells that handle viral infection and immune memory.",
    high: "Viral infection; also tuberculosis and whooping cough.",
    low: "Acute stress, steroids or long-standing illness.",
  },
  monocytes: {
    desc: "Scavenging white cells that clear debris after an infection.",
    high: "Chronic infection such as tuberculosis, or recovery from one.",
  },
  eosinophils: {
    desc: "White cells raised by allergy and parasites.",
    high: "Allergy, asthma or worm infestation.",
  },
  basophils: {
    desc: "The rarest white cells - allergic and inflammatory responses.",
  },
  esr: {
    desc: "How fast red cells settle - a general marker of inflammation.",
    high: "Non-specific: infection, inflammation, anaemia or pregnancy.",
  },
  esrwestergren: {
    desc: "How fast red cells settle in an hour - a general inflammation marker.",
    high: "Non-specific: infection, inflammation, anaemia or pregnancy.",
  },

  // ── Sugars ──
  glucosefasting: {
    desc: "Blood sugar after 8 or more hours without food.",
    high: "110 - 125 suggests prediabetes; 126 and above, on two occasions, diabetes.",
    low: "Hypoglycaemia - can follow a missed meal or diabetes medication.",
  },
  glucosepostprandial: {
    desc: "Blood sugar two hours after a meal - the body's clearing response.",
    high: "Impaired clearance; 200 and above points to diabetes.",
  },
  randombloodsugar: {
    desc: "Blood sugar at any time of day, with no fasting.",
    high: "200 and above with symptoms is diagnostic of diabetes.",
    low: "Hypoglycaemia - treat before anything else.",
  },
  hba1c: {
    desc: "Average blood sugar over the past 2 - 3 months.",
    high: "5.7 - 6.4% prediabetes; 6.5% and above diabetes. Under 7% is the usual treatment target.",
  },

  // ── Lipids ──
  totalcholesterol: {
    desc: "All cholesterol in the blood, good and bad together.",
    high: "Raises cardiovascular risk - read with LDL and HDL, not alone.",
  },
  triglycerides: {
    desc: "The blood's circulating fat, strongly diet-driven.",
    high: "Alcohol, refined carbohydrate, uncontrolled diabetes. Needs a 12-hour fast to read.",
  },
  hdlcholesterol: {
    desc: "\"Good\" cholesterol - carries fat away from the artery wall.",
    low: "A low HDL is itself a risk factor; exercise raises it.",
  },
  ldlcholesterol: {
    desc: "\"Bad\" cholesterol - the fraction that deposits in artery walls.",
    high: "The primary target of diet and statin treatment.",
  },
  vldlcholesterol: {
    desc: "The triglyceride-carrying fraction, calculated from them.",
  },
  nonhdlcholesterol: {
    desc: "Everything except HDL - all the artery-clogging fractions in one number.",
    high: "A better risk marker than LDL alone when triglycerides are high.",
  },
  totalcholesterolhdlratio: {
    desc: "Total cholesterol divided by HDL - risk in a single figure.",
    high: "The higher the ratio, the higher the cardiovascular risk.",
  },

  // ── Liver ──
  totalbilirubin: {
    desc: "Pigment from broken-down red cells, cleared by the liver.",
    high: "Jaundice appears above about 2.5 - liver disease, obstruction or haemolysis.",
  },
  /* The standalone Bilirubin Test splits total bilirubin by age, because the
     two ranges do not overlap - see the BILIRUBIN template in
     seed-lab-analytes.ts. Both spellings of the row need a note of their own,
     or the split rows print bare. */
  totalbilirubinadult: {
    desc: "Pigment from broken-down red cells, cleared by the liver. Range shown is for adults and older children.",
    high: "Jaundice appears above about 2.5 - liver disease, obstruction or haemolysis.",
  },
  totalbilirubininfants: {
    desc: "The same pigment, judged against the newborn range - a baby's liver clears it slowly for the first days of life, so a much higher value is still normal.",
    high: "Above the newborn range needs a paediatrician the same day; very high levels are treated with phototherapy.",
  },
  directbilirubin: {
    desc: "The fraction the liver has already processed.",
    high: "Points to obstruction of bile flow rather than to the liver cells.",
  },
  indirectbilirubin: {
    desc: "The unprocessed fraction, before the liver conjugates it.",
    high: "Red cell breakdown, or Gilbert's syndrome - usually harmless.",
  },
  sgotast: {
    desc: "Liver-cell enzyme, also present in heart and muscle.",
    high: "Liver injury; alcohol typically lifts it above SGPT.",
  },
  sgptalt: {
    desc: "The liver's most specific enzyme for cell injury.",
    high: "Hepatitis, fatty liver or a drug reaction.",
  },
  alkalinephosphatase: {
    desc: "Enzyme from the bile ducts and bone.",
    high: "Bile obstruction, or bone growth - it is normally high in children.",
  },
  totalprotein: {
    desc: "Albumin and globulin together - the blood's protein load.",
  },
  albumin: {
    desc: "The liver's main protein; holds fluid inside the vessels.",
    low: "Long-standing liver or kidney disease, or poor nutrition; causes swelling.",
  },
  globulin: {
    desc: "The antibody-carrying protein fraction.",
    high: "Chronic infection or inflammation.",
  },
  agratio: {
    desc: "Albumin against globulin - a check on which fraction has shifted.",
    low: "Falls in chronic liver disease and in long-standing infection.",
  },

  // ── Kidney and electrolytes ──
  bloodurea: {
    desc: "Protein waste cleared by the kidneys.",
    high: "Reduced kidney function, dehydration or a high protein load.",
  },
  serumcreatinine: {
    desc: "Muscle waste cleared only by the kidneys - the standard kidney measure.",
    high: "Reduced kidney filtration; rises late, so even a small rise matters.",
  },
  uricacid: {
    desc: "Waste from purine breakdown; crystallises in joints.",
    high: "Gout, kidney impairment, or a purine-rich diet.",
  },
  uricacidmale: {
    desc: "Waste from purine breakdown; crystallises in joints. Male range.",
    high: "Gout, kidney impairment, or a purine-rich diet.",
  },
  uricacidfemale: {
    desc: "Waste from purine breakdown; crystallises in joints. Female range.",
    high: "Gout, kidney impairment, or a purine-rich diet.",
  },
  sodium: {
    desc: "The electrolyte that governs the body's water balance.",
    high: "Dehydration.",
    low: "Fluid overload, vomiting, diuretics - confusion at very low levels.",
  },
  potassium: {
    desc: "The electrolyte that governs heart and muscle rhythm.",
    high: "Kidney impairment or certain BP medicines - can disturb heart rhythm.",
    low: "Vomiting, diarrhoea or diuretics - causes cramps and weakness.",
  },
  chloride: {
    desc: "Electrolyte that moves with sodium and holds acid-base balance.",
  },
  calcium: {
    desc: "Mineral for bone, nerve conduction and clotting.",
    high: "Parathyroid overactivity; read alongside albumin.",
    low: "Vitamin D deficiency - causes tingling and cramps.",
  },
  serumamylase: {
    desc: "Pancreatic enzyme, released when the pancreas is inflamed.",
    high: "Acute pancreatitis; also salivary gland disease.",
  },

  // ── Thyroid ──
  t3triiodothyronine: {
    desc: "The active thyroid hormone at the tissues.",
    high: "Overactive thyroid.",
    low: "Underactive thyroid, or non-thyroidal illness.",
  },
  t4thyroxine: {
    desc: "The main hormone the thyroid gland releases.",
    high: "Overactive thyroid.",
    low: "Underactive thyroid.",
  },
  tsh: {
    desc: "The pituitary's instruction to the thyroid - the most sensitive thyroid test.",
    high: "The gland is being pushed harder: an UNDER-active thyroid.",
    low: "The gland needs no pushing: an OVER-active thyroid.",
  },

  // ── Inflammation, vitamins, serology ──
  creactiveprotein: {
    desc: "Protein the liver releases within hours of inflammation.",
    high: "Active infection or inflammation; rises and falls faster than ESR.",
  },
  vitaminb12: {
    desc: "Vitamin for nerve function and red cell formation.",
    low: "Tiredness, tingling and large-cell anaemia; common on a vegetarian diet.",
  },
  vitamind25oh: {
    desc: "The body's stored form of vitamin D - bone and muscle health.",
    low: "Bone pain and muscle weakness; very common with little sun exposure.",
  },
  rafactor: {
    desc: "Antibody associated with rheumatoid arthritis.",
    high: "Supports rheumatoid arthritis, but occurs in other conditions and in health.",
  },
  denguens1antigen: {
    desc: "Dengue virus protein - detectable in the first ~5 days of fever.",
  },
  dengueigm: {
    desc: "Early dengue antibody - appears from about day 5 of fever.",
  },
  dengueigg: {
    desc: "Later dengue antibody - past infection, or a second one.",
  },
  styphio: {
    desc: "Widal antibody against the typhoid bacterium's body antigen.",
  },
  styphih: {
    desc: "Widal antibody against the typhoid bacterium's flagellar antigen.",
  },
  sparatyphiah: {
    desc: "Widal antibody against paratyphoid A.",
  },
  sparatyphibh: {
    desc: "Widal antibody against paratyphoid B.",
  },

  // ── Urine ──
  colour: { desc: "Urine colour - darkens with concentration and dehydration." },
  appearance: { desc: "Clarity of the sample; cloudiness suggests cells or crystals." },
  ph: { desc: "Acidity of the urine - relevant to the kind of stone that forms." },
  specificgravity: {
    desc: "How concentrated the urine is - a read on the kidney's concentrating power.",
  },
  proteinalbumin: {
    desc: "Protein leaking through the kidney filter.",
    high: "Persistent protein needs following up - an early sign of kidney damage.",
  },
  glucose: {
    desc: "Sugar in the urine - appears once blood sugar passes the kidney threshold.",
  },
  ketonebodies: {
    desc: "Fat-breakdown products - fasting, vomiting or uncontrolled diabetes.",
  },
  bilesalts: { desc: "Bile constituents in urine - obstructive jaundice." },
  bilepigments: { desc: "Bile pigment in urine - liver disease or obstruction." },
  urobilinogen: { desc: "Bile breakdown product; raised in liver disease and haemolysis." },
  puscells: {
    desc: "White cells in the urine.",
    high: "The usual sign of a urinary tract infection.",
  },
  rbcs: {
    desc: "Red cells in the urine.",
    high: "Stones, infection or injury - never ignore blood in urine.",
  },
  epithelialcells: {
    desc: "Cells shed from the urinary lining; a few are normal.",
    high: "Often contamination - a repeat mid-stream sample settles it.",
  },
  casts: { desc: "Moulds of the kidney tubules; point to kidney rather than bladder." },
  crystals: { desc: "Mineral crystals - relevant to stone formation." },

  // ── Reading-only investigations ──
  impression: { desc: "The reporting doctor's reading of this investigation." },
};

/**
 * The note for an analyte, or null when there isn't one.
 *
 * Falls back once by dropping a trailing parenthetical - so "Haemoglobin (Hb)"
 * finds `haemoglobin` - because the bench types those brackets freely and a
 * missing note is a silently blanker report.
 */
export function analyteNote(name: string): AnalyteNote | null {
  const direct = NOTES[resolve(name)];
  if (direct) return direct;
  const stripped = name.replace(/\([^)]*\)/g, " ").trim();
  return (stripped && NOTES[resolve(stripped)]) || null;
}

/** The description line alone - what the report prints under most analytes. */
export function analyteDescription(name: string): string | null {
  return analyteNote(name)?.desc ?? null;
}

/**
 * The note that fits the flag: the "high" line for a high value, "low" for a
 * low one, nothing for a normal one.
 *
 * Only out-of-range lines get this second sentence. A report where every row
 * carries two lines of prose is a report nobody scans, and the whole point of
 * flagging is that the eye lands on the line that is off.
 */
export function analyteFlagNote(name: string, flag: string): string | null {
  const n = analyteNote(name);
  if (!n) return null;
  if (flag === "HIGH") return n.high ?? null;
  if (flag === "LOW") return n.low ?? null;
  return null;
}

/**
 * What was put in the tube, by catalogue code. Printed in the report header:
 * a result is only meaningful against the specimen it came from, and the
 * counter is asked "was this the fasting sample?" often enough to print it.
 */
const SPECIMENS: Record<string, string> = {
  CBP: "Whole blood (EDTA)",
  ESR: "Whole blood (EDTA)",
  FBS: "Plasma (fasting)",
  PPBS: "Plasma (2h post meal)",
  RBS: "Plasma (random)",
  HBA1C: "Whole blood (EDTA)",
  LIPID: "Serum (12h fast)",
  LFT: "Serum",
  BILIRUBIN: "Serum",
  KFT: "Serum",
  CREAT: "Serum",
  URIC: "Serum",
  AMYLASE: "Serum",
  THYROID: "Serum",
  CRP: "Serum",
  VITB12: "Serum",
  VITD: "Serum",
  RAF: "Serum",
  DENGUE: "Serum",
  WIDAL: "Serum",
  URINE: "Urine (mid-stream)",

  // ── codes introduced with the hospital's own catalogue (lab-catalog.ts) ──
  // Kept in the same map rather than a second one: two lookups for the same
  // question is how a report ends up with a specimen line on some tests and a
  // blank on others, for no reason a technician can see.
  "CBP-M": "Whole blood (EDTA)",
  "CBP-F": "Whole blood (EDTA)",
  "CBP-F-AEC": "Whole blood (EDTA)",
  "HAEMOGRAM-F": "Whole blood (EDTA)",
  "HAEMOGRAM-PED": "Whole blood (EDTA)",
  "HB-M": "Whole blood (EDTA)",
  "HB-F": "Whole blood (EDTA)",
  "HB-PED": "Whole blood (EDTA)",
  BTCT: "Capillary blood (finger prick)",
  PS: "Whole blood (EDTA)",
  BG: "Whole blood (EDTA)",
  "BG-DU": "Whole blood (EDTA)",
  PLBS: "Plasma (post lunch)",
  "FBS-PLBS": "Plasma (fasting & post lunch)",
  GTT: "Plasma (serial)",
  UREA: "Serum",
  "CREAT-RBS": "Serum & plasma",
  RFT: "Serum",
  CALCIUM: "Serum",
  PROTEIN: "Serum",
  ELECTROLYTES: "Serum",
  HIV: "Serum",
  HBSAG: "Serum",
  "HIV-VDRL": "Serum",
  "HIV-BG": "Serum & whole blood (EDTA)",
  "HIV-HBSAG": "Serum",
  "HBSAG-BG": "Serum & whole blood (EDTA)",
  "HBSAG-VDRL": "Serum",
  "HIV-VDRL-BG": "Serum & whole blood (EDTA)",
  "HIV-HBSAG-BG": "Serum & whole blood (EDTA)",
  "HBSAG-VDRL-BG": "Serum & whole blood (EDTA)",
  "HIV-HBSAG-VDRL": "Serum",
  "HIV-HBSAG-VDRL-BG": "Serum & whole blood (EDTA)",
  "HIV-HBSAG-VDRL-HCV": "Serum",
  "MP-PF-PV": "Whole blood (EDTA)",
  "MP-PF-PAN": "Whole blood (EDTA)",
  // Not a specimen at all - the reading is taken off the patient's forearm.
  MONTOUX: "Intradermal (forearm)",
  CUE: "Urine (mid-stream)",
  FLUID: "Body fluid (as collected)",
  SEMEN: "Semen",
  ANTENATAL: "Serum & whole blood (EDTA)",
};

/** The specimen line for a test, or null when the catalogue code is unknown. */
export function specimenFor(code: string | null | undefined): string | null {
  return code ? SPECIMENS[code.toUpperCase()] ?? null : null;
}

/**
 * The department heading a test is filed under - the centred band above the
 * table on the printed report ("HAEMATOLOGY", "BIOCHEMISTRY").
 *
 * A lab report is read by section, not by test: a doctor scanning a five-page
 * report finds the sugars by looking for BIOCHEMISTRY, not by reading every
 * analyte name. Kept here beside the specimen map for the same reason - it is a
 * property of the catalogue entry, not of a particular patient's sample.
 */
const DEPARTMENTS: Record<string, string> = {
  CBP: "HAEMATOLOGY",
  ESR: "HAEMATOLOGY",
  FBS: "BIOCHEMISTRY",
  PPBS: "BIOCHEMISTRY",
  RBS: "BIOCHEMISTRY",
  HBA1C: "BIOCHEMISTRY",
  LIPID: "BIOCHEMISTRY",
  LFT: "BIOCHEMISTRY",
  BILIRUBIN: "BIOCHEMISTRY",
  KFT: "BIOCHEMISTRY",
  CREAT: "BIOCHEMISTRY",
  URIC: "BIOCHEMISTRY",
  AMYLASE: "BIOCHEMISTRY",
  THYROID: "BIOCHEMISTRY",
  VITB12: "BIOCHEMISTRY",
  VITD: "BIOCHEMISTRY",
  CRP: "SEROLOGY",
  RAF: "SEROLOGY",
  DENGUE: "SEROLOGY",
  WIDAL: "SEROLOGY",
  URINE: "CLINICAL PATHOLOGY",
  ECG: "CARDIOLOGY",
  ECHO: "CARDIOLOGY",
  XRAYCHEST: "RADIOLOGY",

  // ── codes introduced with the hospital's own catalogue (lab-catalog.ts) ──
  // The `group` on each CatalogSpec is the same division and exists for the
  // ordering screen; this map is what prints. They are kept in step by hand -
  // if that ever stops being true, this should read from the spec instead.
  "CBP-M": "HAEMATOLOGY",
  "CBP-F": "HAEMATOLOGY",
  "CBP-F-AEC": "HAEMATOLOGY",
  "HAEMOGRAM-F": "HAEMATOLOGY",
  "HAEMOGRAM-PED": "HAEMATOLOGY",
  "HB-M": "HAEMATOLOGY",
  "HB-F": "HAEMATOLOGY",
  "HB-PED": "HAEMATOLOGY",
  BTCT: "HAEMATOLOGY",
  PS: "HAEMATOLOGY",
  BG: "BLOOD BANKING",
  "BG-DU": "BLOOD BANKING",
  PLBS: "BIOCHEMISTRY",
  "FBS-PLBS": "BIOCHEMISTRY",
  GTT: "BIOCHEMISTRY",
  UREA: "BIOCHEMISTRY",
  "CREAT-RBS": "BIOCHEMISTRY",
  RFT: "BIOCHEMISTRY",
  CALCIUM: "BIOCHEMISTRY",
  PROTEIN: "BIOCHEMISTRY",
  ELECTROLYTES: "BIOCHEMISTRY",
  HIV: "SEROLOGY",
  HBSAG: "SEROLOGY",
  "HIV-VDRL": "SEROLOGY",
  "HIV-BG": "SEROLOGY",
  "HIV-HBSAG": "SEROLOGY",
  "HBSAG-BG": "SEROLOGY",
  "HBSAG-VDRL": "SEROLOGY",
  "HIV-VDRL-BG": "SEROLOGY",
  "HIV-HBSAG-BG": "SEROLOGY",
  "HBSAG-VDRL-BG": "SEROLOGY",
  "HIV-HBSAG-VDRL": "SEROLOGY",
  "HIV-HBSAG-VDRL-BG": "SEROLOGY",
  "HIV-HBSAG-VDRL-HCV": "SEROLOGY",
  "MP-PF-PV": "SEROLOGY",
  "MP-PF-PAN": "SEROLOGY",
  MONTOUX: "SEROLOGY",
  CUE: "CLINICAL PATHOLOGY",
  FLUID: "CLINICAL PATHOLOGY",
  SEMEN: "CLINICAL PATHOLOGY",
  ANTENATAL: "PROFILES",
};

/** The department band for a test, or null when the code is unknown. */
export function departmentFor(code: string | null | undefined): string | null {
  return code ? DEPARTMENTS[code.toUpperCase()] ?? null : null;
}

/**
 * How the analyte was measured - the small italic "Method : ..." line printed
 * under the investigation name.
 *
 * ONLY analytes whose method is actually known are listed. A method is an
 * analytical claim about how this laboratory ran this test; printing a guessed
 * one on a signed report is worse than printing none, so `methodFor` returns
 * null for anything absent and the sheet simply omits the line.
 *
 * The haematology entries are transcribed from the hospital's own existing
 * printed report, which is the authority on what its analyser does. Anything
 * the lab changes - or any analyte added later - belongs here, and the day this
 * list stops matching the bench is the day it should be moved into the
 * catalogue and edited from Admin instead.
 */
const METHODS: Record<string, string> = {
  haemoglobin: "Non-cyanide haemoglobin analysis",
  totalwbccount: "Electrical impedance",
  neutrophils: "Electrical impedance",
  lymphocytes: "Electrical impedance",
  monocytes: "Microscopy",
  eosinophils: "Microscopy",
  basophils: "Microscopy",
  rbccount: "Electrical impedance",
  pcvhaematocrit: "Calculated",
  mcv: "Calculated",
  mch: "Calculated",
  mchc: "Calculated",
  plateletcount: "Electrical impedance & microscopy",
  esrwestergren: "Westergren",
  esr: "Westergren",
};

/** The method line for an analyte, or null when this lab has not stated one. */
export function methodFor(name: string): string | null {
  return METHODS[resolve(name)] ?? null;
}
