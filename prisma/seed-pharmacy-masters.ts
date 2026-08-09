import { PrismaClient } from "@prisma/client";

/**
 * EXAMPLE PHARMACY MASTER DATA.
 *
 *   npx tsx prisma/seed-pharmacy-masters.ts --dry     # show what would happen
 *   npx tsx prisma/seed-pharmacy-masters.ts           # create the missing rows
 *   npx tsx prisma/seed-pharmacy-masters.ts --link    # ...and link exact matches
 *
 * A STARTING VOCABULARY, NOT A PRESCRIPTION. Every hospital describes its shelf
 * slightly differently, so this is meant to be run once and then edited on the
 * Master data screen - retire what you don't use, add what you do.
 *
 * THREE THINGS IT WILL NOT DO:
 *
 *   It never edits a row that already exists. Matching is by name/code, and a
 *   match is SKIPPED, not overwritten - so anything you have already corrected
 *   by hand survives a re-run. That also makes it safe to run twice.
 *
 *   It never classifies a medicine. `--link` connects a product to a master only
 *   where the product's own free-text column ALREADY says so, exactly. It does
 *   not read a brand name and conclude what is in the box.
 *
 *   It never sets a drug schedule on a medicine. The schedule vocabulary is
 *   created so it can be picked from; which products are Schedule H, H1 or X is
 *   a regulatory fact about those products and is only ever entered by a person.
 *
 * ON GST RATES: an HSN is only given a default rate where this hospital's own
 * catalogue already shows what it bills that code at. The rest are left blank on
 * purpose - guessing a rate would light up the "GST ≠ HSN" warning across the
 * catalogue and train everyone to ignore it. Fill them in from your accountant.
 */

const prisma = new PrismaClient();
const dry = process.argv.includes("--dry");
const doLink = process.argv.includes("--link");

/** Therapeutic / shelf groupings. Organisational only - never affects price. */
const CATEGORIES: { name: string; description: string }[] = [
  { name: "Analgesic & antipyretic", description: "Pain and fever" },
  { name: "Antibiotic", description: "Bacterial infection" },
  { name: "Antidiabetic", description: "Blood sugar control" },
  { name: "Cardiovascular", description: "Heart, blood pressure and lipids" },
  { name: "Gastrointestinal", description: "Acidity, motility, laxatives" },
  { name: "Respiratory", description: "Asthma, cough, allergy" },
  { name: "Dermatological", description: "Skin preparations" },
  { name: "Ophthalmic", description: "Eye preparations" },
  { name: "Vitamins & supplements", description: "Nutritional support" },
  { name: "IV fluids", description: "Infusions and electrolytes" },
  { name: "Surgical & consumables", description: "Dressings, syringes, gloves" },
];

/**
 * Salt names, as vocabulary to pick from. Nothing here is attached to a product
 * by this script unless the product's own generic column already names it.
 */
const GENERICS: string[] = [
  "Paracetamol", "Ibuprofen", "Diclofenac", "Aceclofenac", "Aspirin",
  "Amoxicillin", "Azithromycin", "Cefixime", "Ciprofloxacin", "Doxycycline",
  "Metformin", "Glimepiride", "Sitagliptin", "Insulin",
  "Telmisartan", "Amlodipine", "Atenolol", "Losartan", "Rosuvastatin", "Atorvastatin",
  "Pantoprazole", "Omeprazole", "Ranitidine", "Domperidone", "Ondansetron",
  "Bisacodyl", "Lactulose", "Liquid paraffin",
  "Cetirizine", "Levocetirizine", "Montelukast", "Salbutamol",
  "Metronidazole", "Fluconazole", "Prednisolone", "Dexamethasone",
];

/** Who makes it - distinct from the distributor who sells it to you. */
const MANUFACTURERS: string[] = [
  "Cipla", "Sun Pharma", "Dr. Reddy's Laboratories", "Lupin", "Mankind Pharma",
  "Torrent Pharmaceuticals", "Alkem Laboratories", "Zydus Cadila", "Glenmark",
  "Micro Labs", "Intas Pharmaceuticals", "Abbott India", "USV", "Aristo Pharmaceuticals",
  "Emcure", "Hetero", "Macleods", "Ipca Laboratories",
];

/** The FORM the medicine takes. */
const DOSAGE_FORMS: string[] = [
  "Tablet", "Capsule", "Syrup", "Suspension", "Injection", "Infusion",
  "Ointment", "Cream", "Gel", "Drops", "Eye drops", "Inhaler",
  "Suppository", "Sachet", "Spray", "Powder",
];

/** The DISPENSING unit - what one of these is when handed over. Never the pack. */
const UNITS: { name: string; symbol: string | null }[] = [
  { name: "tablet", symbol: null },
  { name: "capsule", symbol: null },
  { name: "ml", symbol: "ml" },
  { name: "g", symbol: "g" },
  { name: "vial", symbol: null },
  { name: "ampoule", symbol: null },
  { name: "sachet", symbol: null },
  { name: "tube", symbol: null },
  { name: "bottle", symbol: null },
  { name: "piece", symbol: null },
  // Already present in this hospital's data - kept so existing rows can link.
  { name: "unit", symbol: null },
];

/** Named GST rates to pick from. */
const TAX_RATES: { name: string; ratePct: number }[] = [
  { name: "Exempt", ratePct: 0 },
  { name: "GST 5%", ratePct: 5 },
  { name: "GST 12%", ratePct: 12 },
  { name: "GST 18%", ratePct: 18 },
];

/**
 * HSN classifications. `defaultTaxRate` is deliberately left undefined for most
 * of these - see the note at the top of this file.
 */
const HSN_CODES: { code: string; description: string }[] = [
  { code: "3003", description: "Medicaments, not packaged for retail sale" },
  { code: "3004", description: "Medicaments, packaged for retail sale" },
  { code: "300410", description: "Medicaments containing penicillins or streptomycins" },
  { code: "300420", description: "Medicaments containing other antibiotics" },
  { code: "300431", description: "Medicaments containing insulin" },
  { code: "300450", description: "Medicaments containing vitamins" },
  { code: "300490", description: "Other medicaments for therapeutic or prophylactic use" },
  { code: "3002", description: "Blood, antisera, vaccines and cultures" },
  { code: "3005", description: "Wadding, gauze, bandages and similar dressings" },
  { code: "3006", description: "Pharmaceutical goods - sutures, dressings, kits" },
  { code: "9018", description: "Medical, surgical and dental instruments" },
];

/**
 * Drug schedules under the Drugs and Cosmetics Rules, 1945.
 *
 * The VOCABULARY only, so a pharmacist has something to pick from. No medicine
 * is attached to any of these, here or anywhere else in this codebase.
 *
 * `retentionYears` is left NULL on purpose. Register retention and the exact
 * dispensing obligations vary with the substance and with state rules, and a
 * number invented here would look authoritative while being wrong. Set them on
 * the Master data screen from your own licence documentation.
 */
const SCHEDULES: { code: string; description: string; requiresPrescription: boolean }[] = [
  { code: "H", description: "Prescription-only. Sale against a registered practitioner's prescription.", requiresPrescription: true },
  { code: "H1", description: "Prescription-only, with a separate register of every sale to be maintained.", requiresPrescription: true },
  { code: "X", description: "Prescription-only, tighter controls - prescription retained, dedicated register.", requiresPrescription: true },
  { code: "G", description: "Carries the statutory 'to be taken under medical supervision' caution.", requiresPrescription: false },
  { code: "OTC", description: "Over the counter - no prescription required.", requiresPrescription: false },
];

type Tally = { created: number; skipped: number };
const tallies: Record<string, Tally> = {};
const bump = (k: string, made: boolean) => {
  const t = (tallies[k] ??= { created: 0, skipped: 0 });
  if (made) t.created++; else t.skipped++;
};

async function main() {
  console.log(dry ? "\n── DRY RUN - nothing will be written ──\n" : "\n── SEEDING PHARMACY MASTERS ──\n");

  // ── TAX RATES first: HSN codes below may reference them. ──
  const taxByName = new Map<string, string>();
  for (const t of TAX_RATES) {
    const found = await prisma.taxRate.findUnique({ where: { name: t.name }, select: { id: true } });
    if (found) { taxByName.set(t.name, found.id); bump("Tax rates", false); continue; }
    if (dry) { console.log(`  + tax rate  ${t.name}`); bump("Tax rates", true); continue; }
    const made = await prisma.taxRate.create({
      data: { name: t.name, ratePct: t.ratePct.toFixed(2) }, select: { id: true },
    });
    taxByName.set(t.name, made.id);
    bump("Tax rates", true);
  }

  // ── WHAT THIS HOSPITAL ALREADY BILLS EACH HSN AT ──
  // The only honest source of a default rate. An HSN that appears on exactly one
  // rate in the live catalogue gets that rate; anything ambiguous is left blank
  // for a human, because guessing would fire the GST-mismatch warning wrongly.
  const meds = await prisma.medicine.findMany({ select: { hsnCode: true, gstRatePct: true } });
  const ratesSeen = new Map<string, Set<string>>();
  for (const m of meds) {
    const code = (m.hsnCode ?? "").trim();
    if (!code) continue;
    if (!ratesSeen.has(code)) ratesSeen.set(code, new Set());
    ratesSeen.get(code)!.add(Number(m.gstRatePct).toFixed(2));
  }

  for (const h of HSN_CODES) {
    const found = await prisma.hsnCode.findUnique({ where: { code: h.code }, select: { id: true } });
    if (found) { bump("HSN codes", false); continue; }

    const seen = ratesSeen.get(h.code);
    let defaultTaxRateId: string | undefined;
    let note = "";
    if (seen && seen.size === 1) {
      const pct = Number([...seen][0]);
      const match = TAX_RATES.find((t) => t.ratePct === pct);
      if (match) {
        defaultTaxRateId = taxByName.get(match.name);
        note = `  (default ${match.name} - what your catalogue already bills it at)`;
      }
    } else if (seen && seen.size > 1) {
      note = `  (no default - your catalogue bills this at ${[...seen].join("% and ")}%)`;
    }

    if (dry) { console.log(`  + hsn       ${h.code}${note}`); bump("HSN codes", true); continue; }
    await prisma.hsnCode.create({
      data: { code: h.code, description: h.description, defaultTaxRateId: defaultTaxRateId ?? null },
    });
    bump("HSN codes", true);
  }

  // ── The plain name-keyed masters. ──
  for (const c of CATEGORIES) {
    const found = await prisma.medicineCategory.findUnique({ where: { name: c.name }, select: { id: true } });
    if (found) { bump("Categories", false); continue; }
    if (!dry) await prisma.medicineCategory.create({ data: { name: c.name, description: c.description } });
    bump("Categories", true);
  }
  for (const name of GENERICS) {
    const found = await prisma.generic.findUnique({ where: { name }, select: { id: true } });
    if (found) { bump("Generics", false); continue; }
    if (!dry) await prisma.generic.create({ data: { name } });
    bump("Generics", true);
  }
  for (const name of MANUFACTURERS) {
    const found = await prisma.manufacturer.findUnique({ where: { name }, select: { id: true } });
    if (found) { bump("Manufacturers", false); continue; }
    if (!dry) await prisma.manufacturer.create({ data: { name } });
    bump("Manufacturers", true);
  }
  for (const name of DOSAGE_FORMS) {
    const found = await prisma.dosageForm.findUnique({ where: { name }, select: { id: true } });
    if (found) { bump("Dosage forms", false); continue; }
    if (!dry) await prisma.dosageForm.create({ data: { name } });
    bump("Dosage forms", true);
  }
  for (const u of UNITS) {
    const found = await prisma.unitOfMeasure.findUnique({ where: { name: u.name }, select: { id: true } });
    if (found) { bump("Units", false); continue; }
    if (!dry) await prisma.unitOfMeasure.create({ data: { name: u.name, symbol: u.symbol } });
    bump("Units", true);
  }
  for (const s of SCHEDULES) {
    const found = await prisma.drugSchedule.findUnique({ where: { code: s.code }, select: { id: true } });
    if (found) { bump("Drug schedules", false); continue; }
    if (!dry) {
      await prisma.drugSchedule.create({
        data: {
          code: s.code, description: s.description,
          requiresPrescription: s.requiresPrescription,
          retentionYears: null, // see the note on SCHEDULES
        },
      });
    }
    bump("Drug schedules", true);
  }

  console.log("  " + "─".repeat(46));
  for (const [k, t] of Object.entries(tallies)) {
    console.log(`  ${k.padEnd(16)} ${String(t.created).padStart(3)} new · ${t.skipped} already there`);
  }

  if (doLink) await linkExactMatches();

  console.log(
    doLink
      ? "\n  Masters are in place and exact matches are linked.\n"
      : "\n  Masters are in place. Re-run with --link to connect medicines whose\n" +
        "  existing free text matches one of these exactly.\n"
  );
  console.log("  Drug schedules were created as a vocabulary only - no medicine has been");
  console.log("  classified. Set those yourself on each medicine.\n");
}

/**
 * LINK ONLY WHAT IS ALREADY WRITTEN DOWN.
 *
 * Exact match, case- and whitespace-insensitive, on the medicine's OWN legacy
 * column. "Paracetamol" links to the Paracetamol generic; "Dolo 650" links to
 * nothing, because this script does not know what is in a Dolo 650 and must not
 * pretend to. Anything it cannot match is reported so a person can do it.
 */
async function linkExactMatches() {
  console.log("\n── LINKING EXACT MATCHES ──\n");

  const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const [generics, makers, hsns, units] = await Promise.all([
    prisma.generic.findMany({ select: { id: true, name: true } }),
    prisma.manufacturer.findMany({ select: { id: true, name: true } }),
    prisma.hsnCode.findMany({ select: { id: true, code: true } }),
    prisma.unitOfMeasure.findMany({ select: { id: true, name: true } }),
  ]);
  const gMap = new Map(generics.map((g) => [key(g.name), g.id]));
  const mMap = new Map(makers.map((m) => [key(m.name), m.id]));
  const hMap = new Map(hsns.map((h) => [key(h.code), h.id]));
  const uMap = new Map(units.map((u) => [key(u.name), u.id]));

  // ON A DRY RUN THE MASTERS DO NOT EXIST YET, because nothing above was
  // written. Without this the preview would report "nothing to link" and be
  // read as "this script does nothing" - which is the opposite of the truth.
  // The ids are placeholders; a dry run never writes them anywhere.
  if (dry) {
    for (const n of GENERICS) if (!gMap.has(key(n))) gMap.set(key(n), "(dry)");
    for (const n of MANUFACTURERS) if (!mMap.has(key(n))) mMap.set(key(n), "(dry)");
    for (const h of HSN_CODES) if (!hMap.has(key(h.code))) hMap.set(key(h.code), "(dry)");
    for (const u of UNITS) if (!uMap.has(key(u.name))) uMap.set(key(u.name), "(dry)");
  }

  const meds = await prisma.medicine.findMany({
    select: {
      id: true, name: true, genericName: true, manufacturer: true, hsnCode: true, unit: true,
      genericId: true, manufacturerId: true, hsnId: true, unitId: true,
    },
    orderBy: { name: "asc" },
  });

  let linked = 0;
  const unmatched: string[] = [];

  for (const m of meds) {
    const data: Record<string, string> = {};
    // Only ever fills a link that is EMPTY. A link somebody has already set by
    // hand is never second-guessed by a script.
    if (!m.genericId && gMap.has(key(m.genericName))) data.genericId = gMap.get(key(m.genericName))!;
    if (!m.manufacturerId && mMap.has(key(m.manufacturer))) data.manufacturerId = mMap.get(key(m.manufacturer))!;
    if (!m.hsnId && hMap.has(key(m.hsnCode))) data.hsnId = hMap.get(key(m.hsnCode))!;
    if (!m.unitId && uMap.has(key(m.unit))) data.unitId = uMap.get(key(m.unit))!;

    // REPORTED WHETHER OR NOT ANYTHING ELSE MATCHED. Checking this only when
    // NOTHING matched hid the most interesting case: a medicine that linked its
    // unit and generic fine but whose HSN is "30499" - five digits, and almost
    // certainly a typo for 300490. A partial match is exactly when a human needs
    // telling.
    const left = [
      !data.genericId && !m.genericId && m.genericName ? `generic "${m.genericName}"` : null,
      !data.manufacturerId && !m.manufacturerId && m.manufacturer ? `manufacturer "${m.manufacturer}"` : null,
      !data.hsnId && !m.hsnId && m.hsnCode ? `hsn "${m.hsnCode}"` : null,
      !data.unitId && !m.unitId && m.unit ? `unit "${m.unit}"` : null,
    ].filter(Boolean);
    if (left.length) unmatched.push(`${m.name} - ${left.join(", ")}`);

    if (Object.keys(data).length === 0) continue;

    console.log(`  ${m.name} → ${Object.keys(data).map((k) => k.replace("Id", "")).join(", ")}`);
    if (!dry) await prisma.medicine.update({ where: { id: m.id }, data });
    linked++;
  }

  console.log(`\n  ${linked} medicine(s) linked.`);
  if (unmatched.length) {
    console.log(`\n  ${unmatched.length} field(s) had no exact match - these need a person:`);
    for (const u of unmatched) console.log(`    · ${u}`);
    console.log(`\n  Nothing was guessed for these. Open each on Stock & batches and pick`);
    console.log(`  from the dropdowns, or add the missing master first.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
