/** READ-ONLY. Current catalogue state before linking. Deleted after use. */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const meds = await p.medicine.findMany({
    select: {
      name: true, genericName: true, manufacturer: true, hsnCode: true, unit: true,
      gstRatePct: true, genericId: true, manufacturerId: true, hsnId: true,
      unitId: true, categoryId: true, dosageFormId: true, scheduleId: true,
    },
    orderBy: { name: "asc" },
  });
  console.log(`MEDICINES: ${meds.length}`);
  console.log(`already linked: generic=${meds.filter(m=>m.genericId).length} maker=${meds.filter(m=>m.manufacturerId).length} hsn=${meds.filter(m=>m.hsnId).length} unit=${meds.filter(m=>m.unitId).length}`);

  const bucket = (vals: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const v of vals) { const k = (v ?? "«blank»").trim() || "«blank»"; m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log("\nHSN values:", JSON.stringify(bucket(meds.map(m => m.hsnCode))));
  console.log("UNIT values:", JSON.stringify(bucket(meds.map(m => m.unit))));
  console.log("GST values:", JSON.stringify(bucket(meds.map(m => Number(m.gstRatePct).toFixed(2)))));
  console.log("GENERIC values:", JSON.stringify(bucket(meds.map(m => m.genericName))));
  console.log("MANUFACTURER values:", JSON.stringify(bucket(meds.map(m => m.manufacturer))));

  console.log("\nALL MEDICINE NAMES:");
  for (const m of meds) console.log(`  ${m.name}`);
  await p.$disconnect();
})();
