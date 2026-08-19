/**
 * REPAIR: volume/weight packs that were received as counts.
 *
 * `parsePack` used to read "200ML" as two hundred dispensing units. Every batch
 * of a liquid or a cream received before that fix therefore landed on the shelf
 * multiplied by its own contents - twelve bottles of ACIFIX RAFT became 2,400 -
 * and its per-unit price divided by the same factor, so a whole bottle billed
 * at Rs 1.16 instead of Rs 231.
 *
 * The GRN is NOT touched. It already records what the distributor invoiced (12
 * packs), which was right all along; only the conversion into shelf units was
 * wrong. This brings the batch back to what the GRN always said.
 *
 * The PURCHASE ledger row is NOT rewritten either. A stock ledger that can be
 * edited is not a ledger - the correction is posted as an ADJUSTMENT, so anyone
 * auditing the batch later sees the receipt, sees the correction, and sees why.
 *
 *   npx tsx scripts/fix-measure-packs.ts             # dry run
 *   EXECUTE=1 npx tsx scripts/fix-measure-packs.ts   # apply
 */
import { prisma } from "../src/lib/prisma";
import { parsePack } from "../src/lib/pharmacy/pack";

const EXECUTE = process.env.EXECUTE === "1";

/** What one of these is when handed over, replacing "ml" / "gm". */
const HANDED_OVER_AS: Record<string, string> = { bottle: "bottle", tube: "tube" };

async function main() {
  const actor = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true } });
  if (!actor) throw new Error("No ADMIN user to attribute the correction to");

  const batches = await prisma.stockBatch.findMany({
    select: {
      id: true, batchNo: true, quantity: true, pack: true, packSize: true, mrp: true, freeQty: true,
      medicine: { select: { id: true, name: true, unit: true, defaultPack: true, defaultPackSize: true } },
      grnItems: { select: { qty: true, freeQty: true } },
      invoiceItems: { select: { id: true } },
    },
  });

  const wrong = batches
    .map((b) => ({ b, spec: parsePack(b.pack) }))
    .filter(({ b, spec }) => !!HANDED_OVER_AS[spec.unit] && b.packSize > 1);

  console.log(`Scanned ${batches.length} batches. Volume/weight packs stored as counts: ${wrong.length}\n`);
  if (!wrong.length) { await prisma.$disconnect(); return; }

  let blocked = 0;
  const plan: { id: string; label: string; from: number; to: number; unit: string; medicineId: string; oldUnit: string }[] = [];

  for (const { b, spec } of wrong) {
    // What the distributor actually invoiced, when we have it. Falling back to
    // dividing out the multiplication is safe because that multiplication is
    // exactly what created the number.
    const invoiced = b.grnItems.reduce((s, g) => s + g.qty + (g.freeQty ?? 0), 0);
    const containers = invoiced || Math.round(b.quantity / b.packSize);

    console.log(`${b.medicine.name.slice(0, 32).padEnd(32)} ${b.batchNo.padEnd(12)} pack=${(b.pack ?? "-").padEnd(7)}`);
    console.log(`    on the shelf : ${b.quantity} (as ${b.packSize}-unit packs)  ->  ${containers} ${spec.unit}${containers === 1 ? "" : "s"}`);
    console.log(`    a patient pays: Rs ${(Number(b.mrp) / b.packSize).toFixed(2)}  ->  Rs ${Number(b.mrp).toFixed(2)}`);
    console.log(`    medicine.unit : "${b.medicine.unit}" -> "${spec.unit}"`);

    // A batch already billed cannot be silently re-based: those invoice lines
    // priced their quantity against the old packSize, and changing it under
    // them would make issued bills disagree with the shelf.
    if (b.invoiceItems.length) {
      console.log(`    !! SKIPPED - ${b.invoiceItems.length} invoice line(s) already reference this batch. Correct those bills first.`);
      blocked++;
      continue;
    }
    plan.push({ id: b.id, label: `${b.medicine.name} ${b.batchNo}`, from: b.quantity, to: containers,
                unit: spec.unit, medicineId: b.medicine.id, oldUnit: b.medicine.unit });
  }

  console.log(`\nTo correct: ${plan.length}${blocked ? `   blocked by existing bills: ${blocked}` : ""}`);
  if (!EXECUTE) { console.log("\nDRY RUN - nothing written. Set EXECUTE=1 to apply."); await prisma.$disconnect(); return; }

  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.stockBatch.update({ where: { id: p.id }, data: { quantity: p.to, packSize: 1, freeQty: 0 } });
      await tx.stockTransaction.create({
        data: {
          batchId: p.id, type: "ADJUSTMENT", qty: p.to - p.from, performedById: actor.id,
          reason: `Pack correction: a volume/weight label was counted as ${p.from / p.to} dispensing units per container. `
                + `Shelf set to ${p.to} ${p.unit}${p.to === 1 ? "" : "s"}, as invoiced. Price is now per ${p.unit}.`,
        },
      });
      // "1 ml" on a bill is not what anybody was handed.
      await tx.medicine.update({ where: { id: p.medicineId }, data: { unit: p.unit, defaultPackSize: 1 } });
    });
    console.log(`  fixed ${p.label}: ${p.from} -> ${p.to} ${p.unit}(s)`);
  }

  console.log("\n=== VERIFY ===");
  const after = await prisma.stockBatch.findMany({
    where: { id: { in: plan.map((p) => p.id) } },
    select: { batchNo: true, quantity: true, packSize: true, mrp: true,
      medicine: { select: { name: true, unit: true, defaultPackSize: true } },
      transactions: { orderBy: { createdAt: "asc" }, select: { type: true, qty: true } } },
  });
  for (const b of after) {
    const ledger = b.transactions.reduce((s, t) => s + t.qty, 0);
    console.log(` ${b.medicine.name.slice(0,28).padEnd(28)} qty=${b.quantity} packSize=${b.packSize} unit="${b.medicine.unit}" `
              + `perUnit=Rs ${Number(b.mrp).toFixed(2)}  ledger=${ledger} ${ledger === b.quantity ? "OK" : "!! MISMATCH"}`);
  }
  const stillWrong = (await prisma.stockBatch.findMany({ select: { pack: true, packSize: true } }))
    .filter((b) => { const s = parsePack(b.pack); return !!HANDED_OVER_AS[s.unit] && b.packSize > 1; });
  console.log(` batches still storing a measure as a count: ${stillWrong.length}`);
  await prisma.$disconnect();
}
main();
