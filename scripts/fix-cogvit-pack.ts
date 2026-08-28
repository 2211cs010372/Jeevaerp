/**
 * CORRECT batch T260849 (COGVIT-ALL) to what the distributor actually invoiced.
 *
 * "1*15" is not a label `parsePack` can read - the `*` fails its pattern - so it
 * fell back to size 1 and the strip was booked as a single dispensing unit. MRP
 * 199 (a PER-STRIP figure) therefore became the price of one tablet, and the
 * second GRN's rate overwrote the batch cost at 151.62 instead of 70.
 *
 * The GRN is NOT touched: it records what SWETHA MEDICAL ENTERPRISES invoiced,
 * and that was right. Only the shelf's reading of it is corrected here, and the
 * quantity move is posted as an ADJUSTMENT rather than written over the ledger.
 *
 *   npx tsx scripts/fix-cogvit-pack.ts             # dry run
 *   EXECUTE=1 npx tsx scripts/fix-cogvit-pack.ts   # apply
 */
import { prisma } from "../src/lib/prisma";
import { parsePack } from "../src/lib/pharmacy/pack";

const EXECUTE = process.env.EXECUTE === "1";

const BATCH_NO = "T260849";
const MED_HINT = "cogvit";

/** What the batch must look like now, or this script is aimed at the wrong row. */
const EXPECT = { pack: "1*15", packSize: 1, quantity: 45, mrp: 199, purchasePrice: 151.62 };
/** What the invoice says it should be: 40 strips of 15, at Rs 70 a strip. */
const TARGET = { pack: "15", packs: 40, purchasePrice: 70 };

const money = (v: unknown) => (v == null ? "-" : Number(v).toFixed(2));

async function main() {
  const b = await prisma.stockBatch.findFirstOrThrow({
    where: { batchNo: { equals: BATCH_NO, mode: "insensitive" }, medicine: { name: { contains: MED_HINT, mode: "insensitive" } } },
    select: {
      id: true, batchNo: true, pack: true, packSize: true, quantity: true, mrp: true, purchasePrice: true, freeQty: true,
      medicine: { select: { name: true, unit: true } },
      invoiceItems: { select: { qty: true, unitPrice: true, invoice: { select: { receiptNo: true } } } },
      transactions: { select: { qty: true } },
    },
  });

  // ---- guards -------------------------------------------------------------
  const bad: string[] = [];
  if (b.pack !== EXPECT.pack) bad.push(`pack is "${b.pack}", expected "${EXPECT.pack}"`);
  if (b.packSize !== EXPECT.packSize) bad.push(`packSize is ${b.packSize}, expected ${EXPECT.packSize}`);
  if (b.quantity !== EXPECT.quantity) bad.push(`quantity is ${b.quantity}, expected ${EXPECT.quantity}`);
  if (Number(b.mrp) !== EXPECT.mrp) bad.push(`mrp is ${money(b.mrp)}, expected ${EXPECT.mrp}`);
  if (Number(b.purchasePrice) !== EXPECT.purchasePrice) bad.push(`purchasePrice is ${money(b.purchasePrice)}, expected ${EXPECT.purchasePrice}`);
  if (bad.length) { console.log(`REFUSED - the batch is not in the state this correction was written for:\n  ${bad.join("\n  ")}`); return; }

  const spec = parsePack(TARGET.pack);
  if (!spec.known || spec.size !== 15) throw new Error(`parsePack("${TARGET.pack}") gave size ${spec.size}, known=${spec.known}`);

  const units = TARGET.packs * spec.size;
  console.log(`${b.medicine.name}  batch ${b.batchNo}`);
  console.log(`  pack          "${b.pack}"  ->  "${TARGET.pack}"`);
  console.log(`  packSize      ${b.packSize}  ->  ${spec.size}`);
  console.log(`  shelf         ${b.quantity} ${b.medicine.unit}s  ->  ${units} (${TARGET.packs} x ${spec.size})   ADJUSTMENT ${units - b.quantity >= 0 ? "+" : ""}${units - b.quantity}`);
  console.log(`  cost/strip    ${money(b.purchasePrice)}  ->  ${money(TARGET.purchasePrice)}`);
  console.log(`  MRP/strip     ${money(b.mrp)}  (unchanged)   ->  per ${b.medicine.unit}: ${money(Number(b.mrp) / spec.size)}`);

  if (b.invoiceItems.length) {
    console.log(`\n  NOTE - ${b.invoiceItems.length} issued bill(s) already priced against packSize ${b.packSize}. They are NOT rewritten here:`);
    for (const i of b.invoiceItems) {
      console.log(`    ${i.invoice.receiptNo}  qty=${i.qty} x ${money(i.unitPrice)} = ${money(i.qty * Number(i.unitPrice))}`
                + `   at the corrected price that line is ${money(i.qty * (Number(b.mrp) / spec.size))}`);
    }
  }

  const actor = await prisma.user.findFirst({ where: { role: "ADMIN", email: "mallesh@gmail.com" }, select: { id: true, email: true } })
             ?? await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true } });
  if (!actor) throw new Error("No ADMIN user to attribute the correction to");
  console.log(`\n  posted as ${actor.email}`);

  if (!EXECUTE) { console.log("\nDRY RUN - nothing written. Set EXECUTE=1 to apply."); return; }

  const delta = units - b.quantity;
  const reason = `Pack correction: "1*15" could not be read as a pack label, so a 15-tablet strip was booked as one `
               + `dispensing unit and MRP 199 (per strip) priced one tablet. Shelf set to ${TARGET.packs} x 15 = ${units} `
               + `${b.medicine.unit}s and cost to Rs ${TARGET.purchasePrice} a strip, per invoice SM26-27/0239 (GRN-2026-000020).`;

  await prisma.$transaction(async (tx) => {
    await tx.stockBatch.update({
      where: { id: b.id },
      data: { pack: TARGET.pack, packSize: spec.size, quantity: units, purchasePrice: TARGET.purchasePrice },
    });
    await tx.stockTransaction.create({
      data: { batchId: b.id, type: "ADJUSTMENT", qty: delta, reason, performedById: actor.id, refId: "GRN-2026-000020" },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.id, action: "STOCK_ADJUSTED", targetTable: "StockBatch", targetId: b.id,
        meta: { delta, reason, medicine: b.medicine.name, batchNo: b.batchNo, source: "fix-cogvit-pack script",
                from: { pack: b.pack, packSize: b.packSize, quantity: b.quantity, purchasePrice: money(b.purchasePrice) },
                to: { pack: TARGET.pack, packSize: spec.size, quantity: units, purchasePrice: money(TARGET.purchasePrice) } },
      },
    });
  });

  const after = await prisma.stockBatch.findUniqueOrThrow({
    where: { id: b.id },
    select: { pack: true, packSize: true, quantity: true, mrp: true, purchasePrice: true, transactions: { select: { qty: true } } },
  });
  const ledger = after.transactions.reduce((s, t) => s + t.qty, 0);
  console.log(`\n=== VERIFY ===`);
  console.log(`  pack="${after.pack}" packSize=${after.packSize} shelf=${after.quantity} cost=${money(after.purchasePrice)} mrp=${money(after.mrp)}`);
  console.log(`  per ${b.medicine.unit}: patient pays ${money(Number(after.mrp) / after.packSize)}, costs us ${money(Number(after.purchasePrice) / after.packSize)}`);
  console.log(`  ledger ${ledger} vs shelf ${after.quantity}  ${ledger === after.quantity ? "OK" : "!! MISMATCH"}`);
}
main().finally(() => prisma.$disconnect());
