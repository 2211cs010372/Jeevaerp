import { PrismaClient } from "@prisma/client";
import { LAB_CATALOG } from "./lab-catalog";

const prisma = new PrismaClient();

/**
 * INFRASTRUCTURE SEED. Idempotent - safe to run against production repeatedly.
 *
 * This seeds only the things the hospital's own staff cannot reasonably type in
 * on day one: the ward/bed layout, the diagnostic price list, and the GST header
 * that goes on every invoice.
 *
 * It deliberately seeds NO PEOPLE and NO STOCK:
 *
 *   doctors, staff   Created by an admin in Admin -> Staff. A seeded doctor is a
 *                    fake consultant with a fake fee sitting on the public
 *                    directory, and a seeded staff account is a known username
 *                    with a known password on a live system.
 *   patients         Registered at reception. A demo patient in the master
 *                    patient index is a clinical safety problem, not untidy data.
 *   pharmacy         Medicines, batches and distributors are entered in the
 *                    pharmacy portal, where the real MRP, expiry and batch
 *                    numbers come off the actual invoice. Seeded stock means the
 *                    shelf lies about what is in the cupboard.
 *
 * Companion seeds, run separately:
 *   npm run seed:admins   the named admin accounts (the only logins seeded)
 *   npm run seed:labs     reference ranges for the catalogue below
 */
async function main() {
  // ---- Hospital config (GST invoice header). Telangana state code = 36. ----
  const existingConfig = await prisma.hospitalConfig.findFirst();
  if (!existingConfig) {
    await prisma.hospitalConfig.create({
      data: {
        legalName: "Jeeva Multi Speciality Hospital",
        addressLine: "# 1-8-81, Sai Nagar, Beside Swimming Pool, Balasamudram",
        city: "Hanamkonda",
        state: "Telangana",
        stateCode: "36",
        pincode: "506001",
        gstin: "36AACCA1234F1Z5", // placeholder - replace with the real GSTIN
        phone: "9704691308",
        email: "info@jeevamultispecialityhospital.com",
        defaultLabGstPct: 0, // diagnostics are generally GST-exempt
      },
    });
    console.log("  ✓ hospital config created (replace the placeholder GSTIN before go-live)");
  } else {
    console.log("  · hospital config already present - left untouched");
  }

  // ---- Counters so generated IDs continue past the seed ----
  const year = new Date().getFullYear();
  await prisma.counter.upsert({ where: { key: `PATIENT-${year}` }, update: {}, create: { key: `PATIENT-${year}`, value: 0 } });

  // ---- Lab test catalog. gstRatePct = 0 (EXEMPT) by default. ----
  // Most diagnostic services are GST-exempt in India. The hospital's CA should
  // confirm and override any test that is actually taxable.
  //
  // The menu itself lives in ./lab-catalog.ts, transcribed from the 52 report
  // forms this lab actually prints. ONE source, imported here and by
  // seed-lab-catalog.ts, because a catalogue defined in two files ends up
  // meaning two different things - and the half that disagrees is the half a
  // result gets flagged against.
  //
  // PRICES ARE ZERO for anything the old catalogue had no equivalent of: a
  // report form does not carry a rate, so there was nothing to transcribe and a
  // guess would be billed to a patient as though it were real. Set them in
  // Admin -> Catalog, or run:  npx tsx prisma/seed-lab-catalog.ts
  for (const t of LAB_CATALOG) {
    // Matched by `code`, not `name`: a prior seed/manual entry may already
    // hold this code under a different display name, and matching on `name`
    // would miss it, then collide on the unique `code` when trying to create.
    //
    // The PRICE is deliberately not re-asserted. Once the hospital has set its
    // own rate in Admin -> Catalog, a re-run of this seed must not quietly put
    // it back to the number in this file.
    const row = await prisma.labTestCatalog.upsert({
      where: { code: t.code },
      update: { name: t.name, active: true },
      create: { name: t.name, code: t.code, price: 0, gstRatePct: 0, active: true },
      select: { id: true },
    });
    await prisma.labAnalyte.deleteMany({ where: { catalogId: row.id } });
    await prisma.labAnalyte.createMany({
      data: t.analytes.map((a, i) => ({
        catalogId: row.id,
        name: a.name,
        unit: a.unit ?? null,
        refLow: a.refLow == null ? null : a.refLow.toFixed(4),
        refHigh: a.refHigh == null ? null : a.refHigh.toFixed(4),
        refText: a.refText ?? null,
        sortOrder: i,
      })),
    });
  }
  const analyteCount = LAB_CATALOG.reduce((n, c) => n + c.analytes.length, 0);
  console.log(`  ✓ ${LAB_CATALOG.length} lab tests, ${analyteCount} analytes (GST 0% = exempt by default)`);

  // ---- IPD: wards + beds --------------------------------------------------
  // GST on room rent: exempt below ₹5,000/day (non-ICU). ICU is exempt regardless.
  // So only the ₹5,500 Private ward carries 5%. Confirm with the CA before go-live.
  const wards = [
    { name: "General Ward", category: "GENERAL", floor: "1st Floor", dailyCharge: 1500, gstRatePct: 0, beds: 10, prefix: "GW" },
    { name: "Semi-Private", category: "SEMI_PRIVATE", floor: "2nd Floor", dailyCharge: 3000, gstRatePct: 0, beds: 6, prefix: "SP" },
    { name: "Private Room", category: "PRIVATE", floor: "2nd Floor", dailyCharge: 5500, gstRatePct: 5, beds: 4, prefix: "PR" },
    { name: "ICU", category: "ICU", floor: "3rd Floor", dailyCharge: 8000, gstRatePct: 0, beds: 4, prefix: "ICU" },
  ];

  for (const w of wards) {
    const ward = await prisma.ward.upsert({
      where: { name: w.name },
      update: {},
      create: {
        name: w.name, category: w.category, floor: w.floor,
        dailyCharge: w.dailyCharge, gstRatePct: w.gstRatePct, active: true,
      },
    });
    for (let i = 1; i <= w.beds; i++) {
      const bedNo = `${w.prefix}-${String(i).padStart(2, "0")}`;
      await prisma.bed.upsert({
        where: { wardId_bedNo: { wardId: ward.id, bedNo } },
        // `update: {}` on purpose - re-running the seed must never move an
        // occupied bed back to AVAILABLE and lose track of a live inpatient.
        update: {},
        create: { wardId: ward.id, bedNo, status: "AVAILABLE" },
      });
    }
  }
  const totalBeds = wards.reduce((n, w) => n + w.beds, 0);
  console.log(`  ✓ ${wards.length} wards / ${totalBeds} beds (Private ₹5,500 carries 5% GST, rest exempt)`);

  console.log("\n✅ Infrastructure seed complete. No people, no stock - by design.");
  console.log("   Next:");
  console.log("     npm run seed:admins   create the admin logins");
  console.log("     npm run seed:labs     reference ranges for the catalogue");
  console.log("   Then sign in as an admin and add doctors and staff from Admin → Staff.");
  console.log("   Pharmacy stock is entered in the pharmacy portal.\n");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
