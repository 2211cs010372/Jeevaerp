import { PrismaClient, type ChargeCategory, type ServiceGroup } from "@prisma/client";

/**
 * THE RATE BOARDS ON THE WALL, transcribed.
 *
 *   npx tsx prisma/seed-tariff.ts
 *
 * Two photographed boards at Jeeva Multispeciality, Balasamudram, Hanamkonda
 * (Aug 2026): inpatient + surgery charges on one, the lab menu on the other.
 * Everything below is copied from them verbatim, including the hospital's own
 * spellings ("Appindicectomy", "Ovrian") - a technician checking this list
 * against the board has to see the same words, and silently correcting them
 * makes that check fail for no benefit.
 *
 * IDEMPOTENT. Upserts by name and only ever touches price, category and group,
 * so it can be re-run after the board is repainted. It never deletes: a service
 * withdrawn from the board may still be sitting on an open stay's bill, and
 * removing the catalogue row would not remove the charge - it would just make
 * the charge unexplainable.
 *
 * WARDS ARE RENAMED, NOT REPLACED. The board's room names disagree with the
 * names this system was seeded with ("Sharing Room" for "Semi-Private"). Renaming
 * is safe precisely because Admission.wardNameAtAdmit and BedStay.wardName
 * snapshot the name at the time - every bill already raised keeps the words it
 * was printed with, and only new stays pick up the board's wording.
 */
const prisma = new PrismaClient();

/** Board 1, top block - what an inpatient is charged for, beyond the bed. */
const IP_CHARGES: { name: string; price: number; category: ChargeCategory; perDay?: boolean }[] = [
  { name: "Doctor Consultation", price: 1000, category: "DOCTOR_VISIT" },
  { name: "DMO Charges", price: 800, category: "DOCTOR_VISIT" },
  // "Nursing charges … 600/-" IS on the board, and is deliberately NOT here.
  // Nursing is assigned to every inpatient automatically and accrues per day of
  // stay (NURSE_FEE_PER_DAY in ipd.service). Offering it in the picker as well
  // would let a desk add a second nursing line by hand and bill the family - or
  // an insurer - twice for the same care. Change the rate in that constant.
  { name: "Monitor Charges", price: 1000, category: "PROCEDURE", perDay: true },
  { name: "Emergency Charges", price: 1000, category: "PROCEDURE" },
  { name: "Blood Transfusion (IO Charges)", price: 2500, category: "PROCEDURE" },
  { name: "Oxygen Charges", price: 2000, category: "OXYGEN", perDay: true },
  { name: "Nebulization", price: 300, category: "PROCEDURE" },
  // Printed on the board under surgery but priced as an outpatient visit; kept
  // here so it is findable where the desk looks for consultation rates.
  { name: "OP Consultation", price: 400, category: "DOCTOR_VISIT" },
];

/** Board 1, "SURGERY CHARGES OPEN". */
const SURGERY_OPEN: { name: string; price: number }[] = [
  { name: "Normal Delivery", price: 24999 },
  { name: "Cesarian Section", price: 29999 },
  { name: "Hysterectomy", price: 29999 },
  { name: "Tubectomy", price: 14999 },
  { name: "Hernia", price: 29999 },
  { name: "Hemorrhoids", price: 24999 },
  { name: "Vasectomy", price: 9999 },
  { name: "Hydrocele Surgery", price: 24999 },
];

/** Board 1, "SURGERY CHARGES LAPAROSCOPIC". */
const SURGERY_LAP: { name: string; price: number }[] = [
  { name: "Lap. Hysterectomy", price: 39999 },
  { name: "Lap. Appindicectomy", price: 34999 },
  { name: "Lap. Cholecystectomy", price: 44999 },
  { name: "Lap. Ovrian Cystectomy", price: 39999 },
  { name: "Lap. Tubectomy", price: 19999 },
  { name: "Lap. Hernia", price: 49999 },
];

/** Board 1, room rates. `was` is the name this system seeded, when it differs. */
const WARDS: { name: string; was?: string; category: string; price: number }[] = [
  { name: "ICU", category: "ICU", price: 4500 },
  { name: "Deluxe Room", category: "PRIVATE", price: 5500 },
  { name: "Special Room", was: "Private Room", category: "PRIVATE", price: 4600 },
  { name: "Sharing Room", was: "Semi-Private", category: "SEMI_PRIVATE", price: 3800 },
  { name: "General Ward", category: "GENERAL", price: 2500 },
];

/** Board 2 - the lab menu. Diagnostics are GST-exempt, so no rate is carried. */
const LAB: { name: string; price: number }[] = [
  { name: "Blood Urea", price: 200 },
  { name: "Blood Grouping and Typing", price: 100 },
  { name: "BT/CT", price: 100 },
  { name: "C. Peptide Fasting / Post Lunch", price: 2000 },
  { name: "CBP", price: 400 },
  { name: "Cholesterol", price: 200 },
  { name: "Lipid Profile", price: 700 },
  { name: "CRP", price: 600 },
  { name: "Dengue Check", price: 600 },
  { name: "ESR", price: 200 },
  { name: "T3 T4 TSH", price: 600 },
  { name: "Gravindex Test", price: 100 },
  { name: "Hemoglobin", price: 100 },
  { name: "HBA1C", price: 600 },
  { name: "HBsAg", price: 500 },
  { name: "HCV", price: 500 },
  { name: "HIV", price: 500 },
  { name: "LFT", price: 500 },
  { name: "OGTT", price: 300 },
  { name: "Operation Profile", price: 2500 },
  { name: "PV PF", price: 300 },
  { name: "RBS", price: 100 },
  { name: "FBS/PLBS", price: 100 },
  { name: "RFT", price: 500 },
  { name: "Sr. Uric Acid", price: 300 },
  { name: "Widal", price: 200 },
  { name: "Minor Surgical Profile", price: 1700 },
  { name: "ECG", price: 300 },
  { name: "CUE", price: 100 },
  { name: "Urine Culture Sensitivity", price: 800 },
  { name: "Serum Creatine", price: 300 },
  { name: "Serum Electrolytes", price: 500 },
  { name: "LBC (Liquid-Based Cytology)", price: 2000 },
];

/** Letters and digits only - so "HBA1,C", "HBA1C" and "hba1 c" are one test. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * BOARD NAME → THE NAME THIS LAB ALREADY CATALOGUES IT UNDER.
 *
 * The board is a summary for patients ("LFT", "RFT", "CUE"); the catalogue is
 * the lab's working list, and it spells the same tests out in full with the
 * abbreviation in brackets. Normalising punctuation is not enough to see that
 * "LFT" and "Liver Function Test (LFT)" are one test - and without this map the
 * first run of this script created a second, analyte-less copy of nine tests
 * that the lab could order but never report against.
 *
 * Each entry means: price THIS existing row from the board, do not create a new
 * one. Deliberately explicit rather than a fuzzy match on the bracketed text -
 * this writes to a live clinical catalogue, and a heuristic that is right 90% of
 * the time would silently merge two tests that are genuinely different.
 */
const ALIAS: Record<string, string> = {
  "BT/CT": "Bleeding Time & Clotting Time (BT-CT)",
  "CRP": "C-Reactive Protein (CRP)",
  "CUE": "Complete Urine Examination (CUE)",
  "Dengue Check": "Dengue Check (NS1, IgM, IgG)",
  "Gravindex Test": "Gravindex Test (Urine Pregnancy)",
  "LFT": "Liver Function Test (LFT)",
  "Lipid Profile": "Lipid Profile (LP)",
  "RBS": "Random Blood Sugar (RBS)",
  "RFT": "Renal Function Tests (RFT)",
};

async function service(name: string, group: ServiceGroup, category: ChargeCategory, price: number, perDay = false) {
  await prisma.serviceCharge.upsert({
    where: { name },
    // Deliberately narrow: the board sets price, grouping and category. `active`
    // is NOT reset, so a service the hospital has switched off stays off through
    // a re-run rather than quietly coming back.
    update: { group, category, price: price.toFixed(2), perDay },
    create: { name, group, category, price: price.toFixed(2), perDay, gstRatePct: "0.00" },
  });
}

async function main() {
  console.log("\n  Rate boards → Jeeva\n");

  // Retires the picker entry an earlier run of this script created before it was
  // understood that nursing is applied automatically. Deactivated, not deleted:
  // a stay may already carry a hand-added line raised from it, and removing the
  // catalogue row would leave that charge unexplainable.
  const staleNursing = await prisma.serviceCharge.findUnique({ where: { name: "Nursing Charges" }, select: { id: true, active: true } });
  if (staleNursing?.active) {
    await prisma.serviceCharge.update({ where: { id: staleNursing.id }, data: { active: false } });
    console.log("  ✓ retired the pickable \"Nursing Charges\" - nursing is applied automatically per day");
  }

  for (const s of IP_CHARGES) await service(s.name, "IP_CHARGE", s.category, s.price, s.perDay ?? false);
  for (const s of SURGERY_OPEN) await service(s.name, "SURGERY_OPEN", "PROCEDURE", s.price);
  for (const s of SURGERY_LAP) await service(s.name, "SURGERY_LAPAROSCOPIC", "PROCEDURE", s.price);
  console.log(`  ✓ services: ${IP_CHARGES.length} inpatient · ${SURGERY_OPEN.length} open · ${SURGERY_LAP.length} laparoscopic`);

  // ── WARDS ──
  for (const w of WARDS) {
    const existing =
      (await prisma.ward.findUnique({ where: { name: w.name }, select: { id: true } })) ??
      (w.was ? await prisma.ward.findUnique({ where: { name: w.was }, select: { id: true } }) : null);

    if (existing) {
      await prisma.ward.update({
        where: { id: existing.id },
        data: { name: w.name, category: w.category, dailyCharge: w.price.toFixed(2) },
      });
      console.log(`  ✓ ward ${w.was && w.was !== w.name ? `${w.was} → ${w.name}` : w.name}: ₹${w.price}/day`);
    } else {
      // Created with no beds. Somebody has to decide how many rooms of this kind
      // the building actually has, and inventing a number here would put beds on
      // the board that do not exist.
      await prisma.ward.create({
        data: { name: w.name, category: w.category, dailyCharge: w.price.toFixed(2), gstRatePct: "0.00", active: true },
      });
      console.log(`  + ward ${w.name}: ₹${w.price}/day  (no beds yet - add them under Wards & beds)`);
    }
  }

  // ── LAB ── matched on a normalised name so the board's punctuation does not
  // create a duplicate of a test that is already catalogued with its analytes.
  const catalog = await prisma.labTestCatalog.findMany({ select: { id: true, name: true, price: true } });
  const byKey = new Map(catalog.map((c) => [key(c.name), c]));
  let updated = 0, created = 0;
  const repriced: string[] = [];

  for (const t of LAB) {
    // The alias wins where there is one - see ALIAS for why a normalised name
    // comparison cannot find these on its own.
    const hit = byKey.get(key(ALIAS[t.name] ?? t.name)) ?? byKey.get(key(t.name));
    if (hit) {
      if (Number(hit.price) !== t.price) {
        repriced.push(`${hit.name}: ₹${Number(hit.price)} → ₹${t.price}`);
        await prisma.labTestCatalog.update({ where: { id: hit.id }, data: { price: t.price.toFixed(2) } });
        updated++;
      }
    } else {
      // New to the catalogue: priced and orderable at once, but with no analytes
      // behind it, so it reports as a single free-text result until somebody
      // builds its template. Better than being unorderable.
      await prisma.labTestCatalog.create({
        data: { name: t.name, price: t.price.toFixed(2), gstRatePct: "0.00", active: true },
      });
      created++;
      console.log(`  + lab ${t.name}: ₹${t.price}  (no analyte template yet)`);
    }
  }

  for (const r of repriced) console.log(`  ✓ lab ${r}`);
  console.log(`\n  lab: ${updated} repriced · ${created} added · ${LAB.length - updated - created} already correct`);

  // Anything the lab still sells that is NOT on the board. Reported, never
  // touched - the board is a summary for patients, not the full menu.
  const boardKeys = new Set(LAB.map((t) => key(t.name)));
  const offBoard = catalog.filter((c) => !boardKeys.has(key(c.name)));
  if (offBoard.length) {
    console.log(`\n  ${offBoard.length} catalogued tests are not on the board - left untouched:`);
    for (const c of offBoard.slice(0, 20)) console.log(`      ${c.name} (₹${Number(c.price)})`);
    if (offBoard.length > 20) console.log(`      …and ${offBoard.length - 20} more`);
  }
  console.log("");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
