/** READ-ONLY. Batches whose pack label parsePack cannot read - each one is a
 *  strip booked as a single dispensing unit, and a per-strip MRP charged per tablet. */
import { prisma } from "../src/lib/prisma";
import { parsePack } from "../src/lib/pharmacy/pack";

async function main() {
  const batches = await prisma.stockBatch.findMany({
    select: { id: true, batchNo: true, pack: true, packSize: true, quantity: true, mrp: true,
              medicine: { select: { name: true, defaultPackSize: true } },
              invoiceItems: { select: { qty: true, unitPrice: true, invoice: { select: { receiptNo: true } } } } },
  });
  const bad = batches.filter((b) => b.pack?.trim() && !parsePack(b.pack).known && b.packSize === 1);
  console.log(`${batches.length} batches, ${bad.length} with a pack label that could not be read:\n`);
  let billed = 0;
  for (const b of bad) {
    const hint = b.medicine.defaultPackSize > 1 ? `master says ${b.medicine.defaultPackSize}/pack` : "no master pack size";
    console.log(`  ${b.medicine.name.slice(0,26).padEnd(26)} ${b.batchNo.padEnd(12)} pack="${b.pack}" qty=${String(b.quantity).padStart(5)} mrp=${Number(b.mrp).toFixed(2).padStart(8)}  ${hint}`);
    for (const i of b.invoiceItems) {
      billed++;
      console.log(`      billed ${i.invoice.receiptNo}: ${i.qty} x ${Number(i.unitPrice).toFixed(2)} = ${(i.qty * Number(i.unitPrice)).toFixed(2)}`);
    }
  }
  console.log(`\n  bills already issued from these batches: ${billed}`);
}
main().finally(() => prisma.$disconnect());
