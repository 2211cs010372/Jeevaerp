/**
 * Replace the lab catalogue with what this hospital actually runs.
 *
 *   npx tsx prisma/seed-lab-catalog.ts            # show what would change
 *   npx tsx prisma/seed-lab-catalog.ts --apply    # do it
 *
 * WHY THIS IS NOT A `deleteMany`
 *
 * "Remove the old tests" cannot mean "delete the rows" in a system that has
 * already reported results. A LabTest row points at its catalogue entry, and a
 * patient's report from March has to keep meaning what it meant in March. So
 * the retirement rule is:
 *
 *   never ordered   ->  DELETED    (it was only ever a placeholder)
 *   ever ordered    ->  DEACTIVATED (active = false)
 *
 * A deactivated entry vanishes from every ordering screen - which is what the
 * hospital asked for - while the history that references it stays readable and
 * the decision stays reversible. Deleting it would either break the link or, on
 * this schema, silently null the `catalogId` on a real patient's test.
 *
 * Analytes ARE replaced wholesale per test: they are a template, not a record.
 * The numbers actually reported live on LabResultItem, which this never touches.
 */
import { PrismaClient } from "@prisma/client";
import { LAB_CATALOG, PRICE_CARRYOVER } from "./lab-catalog";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const codes = LAB_CATALOG.map((c) => c.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) throw new Error(`duplicate codes in lab-catalog.ts: ${dupes.join(", ")}`);

  const existing = await prisma.labTestCatalog.findMany({
    select: { id: true, name: true, code: true, price: true, active: true,
              _count: { select: { labTests: true } } },
  });
  const byCode = new Map(existing.filter((e) => e.code).map((e) => [e.code!, e]));

  // ── what leaves ───────────────────────────────────────────────────────────
  const keep = new Set(codes);
  const retiring = existing.filter((e) => !e.code || !keep.has(e.code));
  const toDelete = retiring.filter((e) => e._count.labTests === 0);
  const toDeactivate = retiring.filter((e) => e._count.labTests > 0 && e.active);

  // ── what arrives ──────────────────────────────────────────────────────────
  const unpriced: string[] = [];
  const arriving = LAB_CATALOG.map((spec) => {
    const current = byCode.get(spec.code);
    const carried = PRICE_CARRYOVER[spec.code];
    const source = current ?? (carried ? byCode.get(carried) : undefined);
    const price = source ? Number(source.price.toString()) : 0;
    if (price === 0) unpriced.push(spec.name);
    return { spec, price, isNew: !current, carriedFrom: !current && source ? carried : null };
  });

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN - nothing written. Re-run with --apply"}\n`);
  console.log(`catalogue in file : ${LAB_CATALOG.length} tests, ` +
              `${LAB_CATALOG.reduce((n, c) => n + c.analytes.length, 0)} analytes`);
  console.log(`already in the db : ${existing.length}`);
  console.log(`  new             : ${arriving.filter((a) => a.isNew).length}`);
  console.log(`  updated         : ${arriving.filter((a) => !a.isNew).length}`);
  console.log(`  deleting        : ${toDelete.length} (never ordered)`);
  console.log(`  deactivating    : ${toDeactivate.length} (have results - kept for history)`);

  if (toDeactivate.length) {
    console.log("\nkept but hidden, because a patient's report points at them:");
    for (const e of toDeactivate) console.log(`  · ${e.name} (${e._count.labTests} test${e._count.labTests === 1 ? "" : "s"})`);
  }
  if (toDelete.length) {
    console.log("\ndeleted outright, never ordered:");
    for (const e of toDelete) console.log(`  · ${e.name}`);
  }

  if (!APPLY) {
    reportPrices(unpriced);
    return;
  }

  // ── apply ─────────────────────────────────────────────────────────────────
  for (const { spec, price, carriedFrom } of arriving) {
    const row = await prisma.labTestCatalog.upsert({
      where: { code: spec.code },
      // Price is NOT re-asserted on an existing row: once the hospital has set
      // its own rate in Admin -> Catalog, re-running this must not undo it.
      update: { name: spec.name, active: true },
      create: { code: spec.code, name: spec.name, price: price.toFixed(2), gstRatePct: 0, active: true },
      select: { id: true },
    });
    if (carriedFrom) console.log(`  price ₹${price} carried from ${carriedFrom} -> ${spec.code}`);

    // Analytes are a template, so replace rather than merge - a row dropped
    // from the file has been dropped from the form and must not linger.
    await prisma.labAnalyte.deleteMany({ where: { catalogId: row.id } });
    await prisma.labAnalyte.createMany({
      data: spec.analytes.map((a, i) => ({
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

  if (toDeactivate.length) {
    await prisma.labTestCatalog.updateMany({
      where: { id: { in: toDeactivate.map((e) => e.id) } },
      data: { active: false },
    });
  }
  for (const e of toDelete) {
    // Analytes cascade; LabTest rows cannot exist here by definition.
    await prisma.labTestCatalog.delete({ where: { id: e.id } });
  }

  const [tests, analytes] = await Promise.all([
    prisma.labTestCatalog.count({ where: { active: true } }),
    prisma.labAnalyte.count(),
  ]);
  console.log(`\ndone - ${tests} active tests, ${analytes} analytes.`);
  reportPrices(unpriced);
}

function reportPrices(unpriced: string[]) {
  if (!unpriced.length) return;
  console.log(`\n${"!".repeat(70)}`);
  console.log(`${unpriced.length} TESTS HAVE NO PRICE (₹0). A report form does not carry a`);
  console.log("rate, so none could be transcribed. Set them in Admin -> Catalog");
  console.log("BEFORE go-live, or they will be billed to a patient at zero:\n");
  for (const n of unpriced) console.log(`  · ${n}`);
  console.log("!".repeat(70));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
