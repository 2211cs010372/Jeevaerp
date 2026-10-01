import { PrismaClient } from "@prisma/client";

/**
 * Fix stock batches that have "NxM" style pack labels (e.g. "1×5", "1x10").
 *
 * These were imported from distributor invoices and stored with packSize=1,
 * because parsePack did not recognise the format. The fix:
 *   - Update packSize to the second number (the actual count per pack)
 *   - Normalise the pack label to the standard form (e.g. "1×5" → "5T")
 *
 * DRY RUN by default. Pass --apply to write changes.
 *
 *   npx tsx scripts/fix-nxm-packs.ts          # preview
 *   npx tsx scripts/fix-nxm-packs.ts --apply  # write
 */

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  console.log(apply ? "\n── APPLYING NxM PACK FIXES ──\n" : "\n── DRY RUN: NxM PACK FIXES (pass --apply to write) ──\n");

  // Find all batches whose pack label looks like NxM
  const batches = await prisma.stockBatch.findMany({
    where: {
      pack: { not: null },
    },
    select: {
      id: true,
      pack: true,
      packSize: true,
      quantity: true,
      mrp: true,
      batchNo: true,
      medicine: { select: { name: true, unit: true } },
    },
  });

  const nxmPattern = /^(\d{1,3})\s*[×xX*]\s*(\d{1,4})$/;
  let fixed = 0;

  for (const b of batches) {
    const raw = (b.pack ?? "").trim();
    const m = raw.match(nxmPattern);
    if (!m) continue;

    const correctPackSize = Number(m[2]);
    const unit = b.medicine.unit ?? "unit";
    // Normalise to the standard label: 5 → "5T" for tablets, "5S" for units
    const suffix = unit === "tablet" ? "T" : unit === "capsule" ? "C" : "S";
    const newPack = `${correctPackSize}${suffix}`;

    const mrp = Number(b.mrp);
    const oldUnitPrice = mrp / Math.max(1, b.packSize);
    const newUnitPrice = mrp / correctPackSize;

    console.log(`  ${b.medicine.name} · batch ${b.batchNo}`);
    console.log(`    pack     : "${raw}" → "${newPack}"`);
    console.log(`    packSize : ${b.packSize} → ${correctPackSize}`);
    console.log(`    unit price: ₹${oldUnitPrice.toFixed(2)} → ₹${newUnitPrice.toFixed(2)}  (MRP ₹${mrp.toFixed(2)} ÷ ${correctPackSize})`);
    console.log(`    stock    : ${b.quantity} ${unit}s`);

    if (apply) {
      await prisma.stockBatch.update({
        where: { id: b.id },
        data: { packSize: correctPackSize, pack: newPack },
      });
      console.log(`    ✓ UPDATED`);
    } else {
      console.log(`    (dry run - not written)`);
    }
    console.log();
    fixed++;
  }

  if (fixed === 0) {
    console.log("  No batches with NxM pack labels found.\n");
  } else {
    console.log(`  ${fixed} batch(es) ${apply ? "fixed" : "would be fixed"}.\n`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
