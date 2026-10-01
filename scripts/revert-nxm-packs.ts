import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Revert the NxM pack fixes applied by fix-nxm-packs.ts --apply.
 * Restores the original pack labels and packSize=1 for all 11 batches.
 */
const REVERTS: { medicine: string; batchNo: string; originalPack: string }[] = [
  { medicine: "ARGINI",           batchNo: "LSC-0453",   originalPack: "1*10"  },
  { medicine: "ADVA P 15*15",    batchNo: "V2602229",   originalPack: "15*1"  },
  { medicine: "PANTAPPI INJ",    batchNo: "DI26013F",   originalPack: "1*1"   },
  { medicine: "EUDICA 300",      batchNo: "VGT261890",  originalPack: "10×10" },
  { medicine: "IRN PURE SAC",    batchNo: "ISP2603",    originalPack: "10*2"  },
  { medicine: "AZIPRED 4 TAB",   batchNo: "AT251547",   originalPack: "10*10" },
  { medicine: "ENLEVO-500MG",    batchNo: "VGT262657",  originalPack: "1×5"   },
  { medicine: "AL-CARE TAB",     batchNo: "GT502043A",  originalPack: "10×10" },
  { medicine: "ALLERTINE-M TAB", batchNo: "2606042E",   originalPack: "10×10" },
  { medicine: "FEMIZEN-XT TAB",  batchNo: "RT-5455",    originalPack: "10×10" },
  { medicine: "NULAZA-12 TAB",   batchNo: "GT501161A",  originalPack: "10×10" },
];

async function main() {
  console.log("\n── REVERTING NxM PACK FIXES ──\n");

  let reverted = 0;
  for (const r of REVERTS) {
    const med = await prisma.medicine.findUnique({ where: { name: r.medicine }, select: { id: true } });
    if (!med) { console.log(`  ✗ ${r.medicine} not found — skipped`); continue; }

    const batch = await prisma.stockBatch.findFirst({
      where: { medicineId: med.id, batchNo: r.batchNo },
      select: { id: true, pack: true, packSize: true },
    });
    if (!batch) { console.log(`  ✗ ${r.medicine} · ${r.batchNo} batch not found — skipped`); continue; }

    await prisma.stockBatch.update({
      where: { id: batch.id },
      data: { pack: r.originalPack, packSize: 1 },
    });
    console.log(`  ✓ ${r.medicine} · ${r.batchNo}: pack "${batch.pack}" → "${r.originalPack}", packSize ${batch.packSize} → 1`);
    reverted++;
  }

  console.log(`\n✅ ${reverted} batch(es) reverted.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
