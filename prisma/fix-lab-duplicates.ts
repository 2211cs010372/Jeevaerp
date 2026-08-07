import { PrismaClient } from "@prisma/client";

/**
 * ONE-OFF REPAIR for duplicates the first run of seed-tariff.ts created.
 *
 *   npx tsx prisma/fix-lab-duplicates.ts
 *
 * That run matched the board's short names ("LFT", "RFT", "CUE") against the
 * catalogue by normalised spelling, which cannot see that "LFT" and "Liver
 * Function Test (LFT)" are the same test. So it added nine second copies. Each
 * copy is orderable and has NO analyte template behind it, which means a
 * technician who picked the wrong one would have a test they could not report -
 * the failure would surface at the bench, on a real patient's sample.
 *
 * seed-tariff.ts now carries an ALIAS map so it cannot happen again. This
 * removes the nine already in the database.
 *
 * SAFE BY CONSTRUCTION. It deletes a row only when ALL of these hold:
 *   - the name is one of the nine, exactly;
 *   - the canonical row it should have matched actually exists;
 *   - the duplicate has no lab tests and no analytes hanging off it.
 * Anything else is reported and left alone. Nothing is merged, because there is
 * nothing on these rows to merge - they were created empty minutes ago.
 *
 * Idempotent: re-running after a clean run finds nothing and says so.
 */
const prisma = new PrismaClient();

/** duplicate name -> the catalogue row it should have priced, and the board price. */
const MERGE: { dupe: string; canonical: string; price: number }[] = [
  { dupe: "BT/CT", canonical: "Bleeding Time & Clotting Time (BT-CT)", price: 100 },
  { dupe: "CRP", canonical: "C-Reactive Protein (CRP)", price: 600 },
  { dupe: "CUE", canonical: "Complete Urine Examination (CUE)", price: 100 },
  { dupe: "Dengue Check", canonical: "Dengue Check (NS1, IgM, IgG)", price: 600 },
  { dupe: "Gravindex Test", canonical: "Gravindex Test (Urine Pregnancy)", price: 100 },
  { dupe: "LFT", canonical: "Liver Function Test (LFT)", price: 500 },
  { dupe: "Lipid Profile", canonical: "Lipid Profile (LP)", price: 700 },
  { dupe: "RBS", canonical: "Random Blood Sugar (RBS)", price: 100 },
  { dupe: "RFT", canonical: "Renal Function Tests (RFT)", price: 500 },
];

async function main() {
  console.log("\n  Repairing lab catalogue duplicates\n");
  let removed = 0, skipped = 0, absent = 0;

  for (const m of MERGE) {
    const dupe = await prisma.labTestCatalog.findUnique({
      where: { name: m.dupe },
      select: { id: true, name: true, _count: { select: { labTests: true, analytes: true } } },
    });
    if (!dupe) { absent++; continue; }

    const canonical = await prisma.labTestCatalog.findUnique({
      where: { name: m.canonical },
      select: { id: true, name: true, price: true },
    });
    if (!canonical) {
      console.log(`  ! ${m.dupe}: no "${m.canonical}" to fold into - left alone`);
      skipped++;
      continue;
    }

    // Somebody ordered against the duplicate between the bad run and this fix.
    // Deleting it would orphan a real test on a real patient, so it stays and a
    // human decides.
    if (dupe._count.labTests > 0 || dupe._count.analytes > 0) {
      console.log(`  ! ${m.dupe}: has ${dupe._count.labTests} test(s) and ${dupe._count.analytes} analyte(s) - NOT deleted, needs a human`);
      skipped++;
      continue;
    }

    await prisma.$transaction([
      prisma.labTestCatalog.update({ where: { id: canonical.id }, data: { price: m.price.toFixed(2) } }),
      prisma.labTestCatalog.delete({ where: { id: dupe.id } }),
    ]);
    console.log(`  ✓ ${m.dupe} removed · "${canonical.name}" priced ₹${Number(canonical.price)} → ₹${m.price}`);
    removed++;
  }

  console.log(`\n  ${removed} removed · ${skipped} left for review · ${absent} already clean\n`);

  // What is still worth a human eye: board entries that now exist alongside a
  // sex- or age-split set the lab already had. Those are NOT duplicates to
  // delete - a woman judged against the male haemoglobin range reads as anaemic
  // - but somebody should decide which one the desk is meant to order.
  const review = ["Hemoglobin", "CBP", "Serum Creatine", "T3 T4 TSH"];
  const present = await prisma.labTestCatalog.findMany({
    where: { name: { in: review } },
    select: { name: true, price: true, _count: { select: { analytes: true } } },
  });
  if (present.length) {
    console.log("  Worth a look - these sit alongside the lab's own split entries:");
    for (const p of present) {
      console.log(`      ${p.name} (₹${Number(p.price)}, ${p._count.analytes} analytes)`);
    }
    console.log("  Keep whichever the bench actually works to, and deactivate the other.\n");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
