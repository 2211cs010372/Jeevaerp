import { PrismaClient } from "@prisma/client";

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
  // confirm and override any test that is actually taxable. Prices are editable
  // in Admin -> Catalog; they are seeded because a lab cannot open without one.
  const labTests = [
    { name: "Complete Blood Picture (CBP)", code: "CBP", price: 300 },

    // Blood Sugar
    { name: "Blood Sugar - Fasting (FBS)", code: "FBS", price: 120 },
    { name: "Blood Sugar - Postprandial (PPBS)", code: "PPBS", price: 120 },
    { name: "Random Blood Sugar (RBS)", code: "RBS", price: 120 },
    { name: "HbA1c", code: "HBA1C", price: 600 },

    // Lipid
    { name: "Lipid Profile", code: "LIPID", price: 800 },

    // Liver
    { name: "Liver Function Test (LFT)", code: "LFT", price: 900 },
    { name: "Bilirubin Test", code: "BILIRUBIN", price: 250 },

    // Kidney
    { name: "Kidney Function Test (KFT)", code: "KFT", price: 900 },
    { name: "Serum Creatinine", code: "CREAT", price: 200 },
    { name: "Uric Acid", code: "URIC", price: 250 },

    // Pancreas
    { name: "Serum Amylase", code: "AMYLASE", price: 350 },

    // Thyroid
    { name: "Thyroid Profile (T3, T4, TSH)", code: "THYROID", price: 700 },

    // Vitamins
    { name: "Vitamin D (25-OH)", code: "VITD", price: 1400 },
    { name: "Vitamin B12", code: "VITB12", price: 1100 },

    // Inflammatory Markers
    { name: "C-Reactive Protein (CRP)", code: "CRP", price: 500 },
    { name: "ESR (Erythrocyte Sedimentation Rate)", code: "ESR", price: 150 },
    { name: "RA Factor", code: "RAF", price: 450 },

    // Urine
    { name: "Urine Routine Examination", code: "URINE", price: 150 },

    // Infectious Diseases
    { name: "Dengue NS1 Antigen", code: "DENGUE", price: 800 },
    { name: "Widal Test", code: "WIDAL", price: 300 },

    // Imaging
    { name: "Chest X-Ray (PA View)", code: "XRAYCHEST", price: 350 },
    { name: "ECG (Electrocardiogram)", code: "ECG", price: 250 },
    { name: "2D Echocardiography (2D Echo)", code: "ECHO", price: 1500 },
  ];
  for (const t of labTests) {
    // Matched by `code`, not `name`: a prior seed/manual entry may already
    // hold this code under a different display name, and matching on `name`
    // would miss it, then collide on the unique `code` when trying to create.
    // `update` repairs the name on that existing row instead of skipping it.
    //
    // The PRICE is deliberately not re-asserted. Once the hospital has set its
    // own rate in Admin -> Catalog, a re-run of this seed must not quietly put
    // it back to the number in this file.
    await prisma.labTestCatalog.upsert({
      where: { code: t.code },
      update: { name: t.name },
      create: { name: t.name, code: t.code, price: t.price, gstRatePct: 0, active: true },
    });
  }
  console.log(`  ✓ ${labTests.length} lab tests in the catalogue (GST 0% = exempt by default)`);

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
