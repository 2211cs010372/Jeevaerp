/**
 * Reference-range templates for the lab catalogue.
 *
 * A technician should never retype "Haemoglobin  g/dL  13-17" for each patient,
 * and the range a result was judged against must be printed beside it. These are
 * standard adult ranges - the lab's pathologist should review them once and edit
 * anything their analyser reports differently.
 *
 * Idempotent: re-run after adding catalogue entries.
 *   npx tsx prisma/seed-lab-analytes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type A = [name: string, unit: string | null, refLow: number | null, refHigh: number | null, refText?: string];

/** Keyed by catalogue `code`. */
const TEMPLATES: Record<string, A[]> = {
  CBP: [
    ["Haemoglobin", "g/dL", 12, 17],
    ["Total WBC Count", "/µL", 4000, 11000],
    ["Platelet Count", "/µL", 150000, 450000],
    ["RBC Count", "million/µL", 4.2, 5.9],
    ["PCV (Haematocrit)", "%", 36, 54],
    ["MCV", "fL", 80, 100],
    ["MCH", "pg", 27, 33],
    ["MCHC", "g/dL", 32, 36],
    ["Neutrophils", "%", 40, 75],
    ["Lymphocytes", "%", 20, 40],
    ["Monocytes", "%", 2, 10],
    ["Eosinophils", "%", 1, 6],
    ["Basophils", "%", 0, 2],
    ["ESR", "mm/hr", null, 20],
  ],

  FBS: [
    ["Glucose (Fasting)", "mg/dL", 70, 110],
  ],

  PPBS: [
    ["Glucose (Post Prandial)", "mg/dL", 100, 170],
  ],

  RBS: [
    ["Random Blood Sugar", "mg/dL", 70, 140],
  ],

  HBA1C: [
    ["HbA1c", "%", 4.0, 5.6],
  ],

  LIPID: [
    ["Total Cholesterol", "mg/dL", 0, 200],
    ["Triglycerides", "mg/dL", 0, 150],
    ["HDL Cholesterol", "mg/dL", 40, 60],
    ["LDL Cholesterol", "mg/dL", 0, 100],
    ["VLDL Cholesterol", "mg/dL", 10, 30],
    ["Non-HDL Cholesterol", "mg/dL", 0, 130],
    ["Total Cholesterol / HDL Ratio", null, 3.0, 5.0],
  ],

  LFT: [
    ["Total Bilirubin", "mg/dL", 0.1, 1.2],
    ["Direct Bilirubin", "mg/dL", 0.0, 0.3],
    ["Indirect Bilirubin", "mg/dL", 0.1, 1.0],
    ["SGOT (AST)", "U/L", 5, 40],
    ["SGPT (ALT)", "U/L", 5, 41],
    ["Alkaline Phosphatase", "U/L", 40, 129],
    ["Total Protein", "g/dL", 6.0, 8.3],
    ["Albumin", "g/dL", 3.4, 5.4],
    ["Globulin", "g/dL", 2.3, 3.5],
    ["A/G Ratio", null, 1.0, 2.2],
  ],

  KFT: [
    ["Blood Urea", "mg/dL", 15, 40],
    ["Serum Creatinine", "mg/dL", 0.5, 1.3],
    ["Uric Acid", "mg/dL", 3.5, 7.2],
    ["Sodium", "mmol/L", 136, 145],
    ["Potassium", "mmol/L", 3.5, 5.1],
    ["Chloride", "mmol/L", 98, 107],
    ["Calcium", "mg/dL", 8.5, 10.5],
  ],

  /**
   * Bilirubin, ordered on its own - the jaundice work-up, without paying for a
   * full LFT.
   *
   * Total Bilirubin is split into an adult and an infant row because the two
   * ranges are not comparable: a healthy 3-day-old sits at a number that would
   * read as liver failure in an adult, so judging a newborn against 0.1-1.2
   * would flag every normal baby as HIGH. The bench fills whichever row matches
   * the patient and leaves the other blank.
   *
   * Spelling is "Bilirubin" throughout, matching the LFT panel above - the
   * printed notes in lab-reference.ts are keyed on the analyte name, so a
   * misspelling silently drops the explanation off the patient's report.
   */
  BILIRUBIN: [
    ["Total Bilirubin (Adult)", "mg/dL", 0.1, 1.2],
    ["Total Bilirubin (Infants)", "mg/dL", 1.2, 12],
    ["Direct Bilirubin", "mg/dL", 0.0, 0.3],
    ["Indirect Bilirubin", "mg/dL", 0.1, 1.0],
  ],

  CREAT: [
    ["Serum Creatinine", "mg/dL", 0.5, 1.3],
  ],

  URIC: [
    ["Uric Acid (Male)", "mg/dL", 3.5, 7.2],
    ["Uric Acid (Female)", "mg/dL", 2.6, 6.0],
  ],

  AMYLASE: [
    ["Serum Amylase", "U/L", 22, 80],
  ],

  THYROID: [
    ["T3 (Triiodothyronine)", "ng/dL", 80, 200],
    ["T4 (Thyroxine)", "µg/dL", 5.1, 14.1],
    ["TSH", "µIU/mL", 0.27, 4.2],
  ],

  CRP: [
    ["C-Reactive Protein", "mg/L", 0, 6],
  ],

  ESR: [
    ["ESR (Westergren)", "mm/hr", 0, 20],
  ],

  VITB12: [
    ["Vitamin B12", "pg/mL", 200, 900],
  ],

  VITD: [
    ["Vitamin D (25-OH)", "ng/mL", 30, 100],
  ],

  RAF: [
    ["RA Factor", "IU/mL", 0, 20],
  ],

  DENGUE: [
    ["Dengue NS1 Antigen", null, null, null, "Negative"],
    ["Dengue IgM", null, null, null, "Negative"],
    ["Dengue IgG", null, null, null, "Negative"],
  ],

  WIDAL: [
    ["S. typhi O", null, null, null, "<1:80"],
    ["S. typhi H", null, null, null, "<1:80"],
    ["S. paratyphi AH", null, null, null, "<1:80"],
    ["S. paratyphi BH", null, null, null, "<1:80"],
  ],

  URINE: [
    ["Colour", null, null, null, "Pale Yellow"],
    ["Appearance", null, null, null, "Clear"],
    ["pH", null, 5.0, 8.0],
    ["Specific Gravity", null, 1.005, 1.030],
    ["Protein (Albumin)", null, null, null, "Nil"],
    ["Glucose", null, null, null, "Nil"],
    ["Ketone Bodies", null, null, null, "Nil"],
    ["Bile Salts", null, null, null, "Nil"],
    ["Bile Pigments", null, null, null, "Nil"],
    ["Urobilinogen", null, null, null, "Normal"],
    ["Pus Cells", "/HPF", 0, 5],
    ["RBCs", "/HPF", 0, 2],
    ["Epithelial Cells", "/HPF", 0, 5],
    ["Casts", null, null, null, "Nil"],
    ["Crystals", null, null, null, "Nil"],
  ],

  ECG: [
    ["Impression", null, null, null],
  ],

  ECHO: [
    ["Impression", null, null, null],
  ],

  XRAYCHEST: [
    ["Impression", null, null, null],
  ],
};
async function main() {
  const catalog = await prisma.labTestCatalog.findMany({ select: { id: true, name: true, code: true } });
  let created = 0, updated = 0, skipped = 0;

  for (const c of catalog) {
    const rows = c.code ? TEMPLATES[c.code] : undefined;
    if (!rows) { skipped++; continue; }
    for (const [i, [name, unit, refLow, refHigh, refText]] of rows.entries()) {
      const data = {
        unit: unit ?? null,
        refLow: refLow == null ? null : refLow.toFixed(4),
        refHigh: refHigh == null ? null : refHigh.toFixed(4),
        refText: refText ?? null,
        sortOrder: i,
      };
      const existing = await prisma.labAnalyte.findUnique({
        where: { catalogId_name: { catalogId: c.id, name } },
        select: { id: true },
      });
      if (existing) { await prisma.labAnalyte.update({ where: { id: existing.id }, data }); updated++; }
      else { await prisma.labAnalyte.create({ data: { catalogId: c.id, name, ...data } }); created++; }
    }
  }

  const total = await prisma.labAnalyte.count();
  console.log(`analytes created: ${created}, updated: ${updated}`);
  console.log(`catalogue entries without a template: ${skipped}`);
  console.log(`total analytes now: ${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
