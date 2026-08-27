/** READ-ONLY. What a batch's numbers actually meant on the invoices and bills. */
import { prisma } from "../src/lib/prisma";
import { parsePack } from "../src/lib/pharmacy/pack";

const BATCH_NO = process.env.BATCH_NO ?? "T260849";
const MED_HINT = process.env.MED_HINT ?? "cogvit";
const money = (v: unknown) => (v == null ? "-" : Number(v).toFixed(2));

async function main() {
  const b = await prisma.stockBatch.findFirstOrThrow({
    where: { batchNo: { equals: BATCH_NO, mode: "insensitive" }, medicine: { name: { contains: MED_HINT, mode: "insensitive" } } },
    select: {
      id: true, batchNo: true, quantity: true, pack: true, packSize: true, mrp: true, purchasePrice: true, freeQty: true,
      medicine: { select: { id: true, name: true, unit: true, defaultPack: true, defaultPackSize: true } },
      grnItems: { select: { qty: true, freeQty: true, unitCost: true, mrp: true, gstRatePct: true, batchNo: true,
                            goodsReceipt: { select: { grnNumber: true, invoiceNo: true, invoiceDate: true, createdAt: true } } } },
      invoiceItems: { select: { qty: true, unitPrice: true, amount: true, description: true,
                                invoice: { select: { receiptNo: true, createdAt: true, patient: { select: { fullName: true } } } } } },
      returnItems: { select: { qty: true } },
    },
  });

  console.log(`${b.medicine.name}  batch ${b.batchNo}   id=${b.id}`);
  console.log(`  medicine.unit="${b.medicine.unit}"  defaultPack=${b.medicine.defaultPack ?? "-"}  defaultPackSize=${b.medicine.defaultPackSize}`);
  console.log(`  batch pack="${b.pack}" packSize=${b.packSize} freeQty=${b.freeQty}  shelf=${b.quantity}`);
  console.log(`  mrp/pack=${money(b.mrp)}  cost/pack=${money(b.purchasePrice)}   ->  per unit: mrp=${money(Number(b.mrp) / b.packSize)} cost=${money(Number(b.purchasePrice) / b.packSize)}`);

  const now = parsePack(b.pack), next = parsePack("15");
  console.log(`  parsePack("${b.pack}") -> size ${now.size}, "${now.unit}", known=${now.known}`);
  console.log(`  parsePack("15")   -> size ${next.size}, "${next.unit}", known=${next.known}\n`);

  console.log("GRN (what the distributor invoiced)");
  for (const g of b.grnItems) {
    console.log(`  ${g.goodsReceipt.grnNumber}  inv ${g.goodsReceipt.invoiceNo ?? "-"}  ${g.goodsReceipt.createdAt.toISOString().slice(0,10)}`);
    console.log(`     qty=${g.qty} free=${g.freeQty}  rate/unitCost=${money(g.unitCost)}  mrp=${money(g.mrp)}  gst=${money(g.gstRatePct)}%`);
  }

  console.log("\nBILLED TO PATIENTS from this batch");
  if (!b.invoiceItems.length) console.log("  (none)");
  for (const i of b.invoiceItems) {
    console.log(`  ${i.invoice.createdAt.toISOString().slice(0,16).replace("T"," ")}  ${i.invoice.receiptNo}  ${i.invoice.patient?.fullName ?? ""}`);
    console.log(`     ${i.description}  qty=${i.qty} x ${money(i.unitPrice)} = ${money(i.amount)}`);
  }
  console.log(`\n  purchase-return lines: ${b.returnItems.length}`);

  const others = await prisma.stockBatch.findMany({
    where: { medicineId: b.medicine.id },
    select: { batchNo: true, pack: true, packSize: true, quantity: true, mrp: true, purchasePrice: true, expiryDate: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nOTHER BATCHES of the same medicine");
  for (const o of others) {
    console.log(`  ${o.batchNo.padEnd(12)} pack=${(o.pack ?? "-").padEnd(8)} size=${String(o.packSize).padStart(3)} qty=${String(o.quantity).padStart(5)}  mrp=${money(o.mrp).padStart(8)} cost=${money(o.purchasePrice).padStart(8)}  exp ${o.expiryDate.toISOString().slice(0,7)}`);
  }
}
main().finally(() => prisma.$disconnect());
