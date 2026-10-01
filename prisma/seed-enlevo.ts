import { PrismaClient } from "@prisma/client";

/**
 * Seed ENLEVO-500MG (Levofloxacin 500mg) with stock data.
 *
 *   npx tsx prisma/seed-enlevo.ts
 *
 * Idempotent - safe to run repeatedly. Existing rows are left untouched.
 */

const prisma = new PrismaClient();

async function main() {
  console.log("\n── SEEDING ENLEVO-500MG STOCK DATA ──\n");

  // ── 1. Ensure the "Opening Stock" supplier exists ──
  //    Every batch on the shelf must trace to a supplier (schema constraint).
  //    For seeded / opening stock that predates procurement, this placeholder
  //    makes the gap visible rather than silent.
  const supplier = await prisma.supplier.upsert({
    where: { name: "Opening Stock" },
    update: {},
    create: {
      name: "Opening Stock",
      contactPerson: null,
      phone: null,
      notes: "Placeholder supplier for stock that predates the procurement module.",
    },
    select: { id: true },
  });
  console.log("  ✓ Supplier: Opening Stock");

  // ── 2. Create the medicine ──
  const med = await prisma.medicine.upsert({
    where: { name: "ENLEVO-500MG" },
    update: {},
    create: {
      name: "ENLEVO-500MG",
      genericName: "Levofloxacin",
      manufacturer: "Micro Labs",
      hsnCode: "3004",
      gstRatePct: "12.00",
      unit: "tablet",
      defaultPack: "10T",
      defaultPackSize: 10,
      courseCritical: true,        // antibiotic — stopping early breeds resistance
      reorderThreshold: 50,
      rackLocation: null,
      active: true,
    },
    select: { id: true },
  });
  console.log("  ✓ Medicine: ENLEVO-500MG (Levofloxacin 500mg)");

  // ── 3. Add stock batches ──
  const batches = [
    {
      batchNo: "ELV-2401",
      expiryDate: new Date("2027-06-30"),
      packs: 20,
      packSize: 10,
      mrp: 159.00,          // MRP per pack of 10 tablets
      purchasePrice: 120.00, // landed cost per pack
      pack: "10T",
    },
    {
      batchNo: "ELV-2402",
      expiryDate: new Date("2027-12-31"),
      packs: 15,
      packSize: 10,
      mrp: 159.00,
      purchasePrice: 122.50,
      pack: "10T",
    },
  ];

  for (const b of batches) {
    const qty = b.packs * b.packSize; // in dispensing units (tablets)
    const batch = await prisma.stockBatch.upsert({
      where: {
        medicineId_batchNo_supplierId: {
          medicineId: med.id,
          batchNo: b.batchNo,
          supplierId: supplier.id,
        },
      },
      update: {},
      create: {
        medicineId: med.id,
        supplierId: supplier.id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        quantity: qty,
        packSize: b.packSize,
        pack: b.pack,
        mrp: b.mrp.toFixed(2),
        purchasePrice: b.purchasePrice.toFixed(2),
      },
      select: { id: true },
    });
    console.log(`  ✓ Batch ${b.batchNo}: ${qty} tablets (${b.packs} packs × ${b.packSize}), MRP ₹${b.mrp}/pack, expiry ${b.expiryDate.toISOString().slice(0, 10)}`);
  }

  const totalTablets = batches.reduce((s, b) => s + b.packs * b.packSize, 0);
  console.log(`\n✅ ENLEVO-500MG seeded: ${batches.length} batches, ${totalTablets} tablets total.\n`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
