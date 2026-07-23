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
    ["Platelet Count", "/µL", 150000, 410000],
    ["RBC Count", "million/µL", 4.5, 5.5],
    ["PCV (Haematocrit)", "%", 40, 50],
    ["Neutrophils", "%", 40, 75],
    ["Lymphocytes", "%", 20, 40],
    ["Eosinophils", "%", 1, 6],
    ["Monocytes", "%", 2, 10],
  ],
  FBS: [["Glucose (Fasting)", "mg/dL", 70, 100]],
  PPBS: [["Glucose (Post Prandial)", "mg/dL", 70, 140]],
  HBA1C: [["HbA1c", "%", 4.0, 5.6]],
  LIPID: [
    ["Total Cholesterol", "mg/dL", null, 200],
    ["Triglycerides", "mg/dL", null, 150],
    ["HDL Cholesterol", "mg/dL", 40, 60],
    ["LDL Cholesterol", "mg/dL", null, 100],
    ["VLDL Cholesterol", "mg/dL", 10, 30],
  ],
  LFT: [
    ["Total Bilirubin", "mg/dL", 0.2, 1.2],
    ["Direct Bilirubin", "mg/dL", 0, 0.3],
    ["SGOT (AST)", "U/L", 5, 40],
    ["SGPT (ALT)", "U/L", 5, 41],
    ["Alkaline Phosphatase", "U/L", 40, 129],
    ["Total Protein", "g/dL", 6.4, 8.3],
    ["Albumin", "g/dL", 3.5, 5.2],
  ],
  KFT: [
    ["Blood Urea", "mg/dL", 15, 40],
    ["Serum Creatinine", "mg/dL", 0.6, 1.3],
    ["Uric Acid", "mg/dL", 3.5, 7.2],
    ["Sodium", "mmol/L", 136, 145],
    ["Potassium", "mmol/L", 3.5, 5.1],
  ],
  THYROID: [
    ["T3 (Triiodothyronine)", "ng/dL", 80, 200],
    ["T4 (Thyroxine)", "µg/dL", 5.1, 14.1],
    ["TSH", "µIU/mL", 0.27, 4.2],
  ],
  CREAT: [["Serum Creatinine", "mg/dL", 0.6, 1.3]],
  CRP: [["C-Reactive Protein", "mg/L", null, 6]],
  ESR: [["ESR (Westergren)", "mm/hr", null, 20]],
  VITB12: [["Vitamin B12", "pg/mL", 200, 900]],
  VITD: [["Vitamin D (25-OH)", "ng/mL", 30, 100]],
  RAF: [["RA Factor", "IU/mL", null, 20]],
  DENGUE: [["Dengue NS1 Antigen", null, null, null, "Negative"]],
  WIDAL: [
    ["S. typhi O", null, null, null, "< 1:80"],
    ["S. typhi H", null, null, null, "< 1:80"],
    ["S. paratyphi AH", null, null, null, "< 1:80"],
    ["S. paratyphi BH", null, null, null, "< 1:80"],
  ],
  URINE: [
    ["Colour", null, null, null, "Pale yellow"],
    ["Appearance", null, null, null, "Clear"],
    ["pH", null, 5.0, 8.0],
    ["Specific Gravity", null, 1.005, 1.03],
    ["Protein (Albumin)", null, null, null, "Nil"],
    ["Glucose", null, null, null, "Nil"],
    ["Pus Cells", "/hpf", null, 5],
    ["RBCs", "/hpf", null, 2],
    ["Epithelial Cells", "/hpf", null, 5],
  ],
  // Imaging reports a reading, not numbers.
  ECG: [["Impression", null, null, null]],
  ECHO: [["Impression", null, null, null]],
  XRAYCHEST: [["Impression", null, null, null]],
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
