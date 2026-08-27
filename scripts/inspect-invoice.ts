/** READ-ONLY. One pharmacy bill, line by line, with its payments. */
import { prisma } from "../src/lib/prisma";
const RECEIPT = process.env.RECEIPT ?? "JMH20260567";
const m = (v: unknown) => (v == null ? "-" : Number(v).toFixed(2));

async function main() {
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { receiptNo: RECEIPT },
    select: {
      id: true, receiptNo: true, source: true, status: true, payer: true, payerName: true, createdAt: true,
      subtotal: true, discountAmount: true, taxableAmount: true, cgstAmount: true, sgstAmount: true, totalAmount: true,
      patient: { select: { fullName: true, displayId: true } },
      items: { select: { id: true, description: true, hsnSac: true, qty: true, unitPrice: true, amount: true, gstRatePct: true,
                         batch: { select: { batchNo: true, pack: true, packSize: true, mrp: true,
                                           medicine: { select: { name: true, unit: true } } } } } },
      payments: { select: { mode: true, amount: true, createdAt: true } },
    },
  });

  console.log(`${inv.receiptNo}  ${inv.patient.fullName} (${inv.patient.displayId})  ${inv.source}  ${inv.status}  ${inv.payer}`);
  console.log(`  raised ${inv.createdAt.toISOString().slice(0,16).replace("T"," ")}\n`);
  console.log("LINES");
  for (const i of inv.items) {
    const b = i.batch;
    console.log(`  ${i.description}`);
    console.log(`     qty=${i.qty}  x ${m(i.unitPrice)}  = ${m(i.amount)}   gst=${m(i.gstRatePct)}%  hsn=${i.hsnSac ?? "-"}`);
    if (b) console.log(`     batch ${b.batchNo}  pack="${b.pack}" packSize=${b.packSize}  mrp/pack=${m(b.mrp)}  -> per ${b.medicine.unit}: ${m(Number(b.mrp) / b.packSize)}`);
    else console.log(`     (no batch linked)`);
  }
  console.log(`\n  subtotal   ${m(inv.subtotal)}`);
  console.log(`  discount   ${m(inv.discountAmount)}`);
  console.log(`  taxable    ${m(inv.taxableAmount)}`);
  console.log(`  cgst+sgst  ${m(inv.cgstAmount)} + ${m(inv.sgstAmount)}`);
  console.log(`  TOTAL      ${m(inv.totalAmount)}`);
  console.log("\nPAYMENTS");
  if (!inv.payments.length) console.log("  (none)");
  for (const p of inv.payments) console.log(`  ${p.createdAt.toISOString().slice(0,16).replace("T"," ")}  ${p.mode}  ${m(p.amount)}`);
  const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
  console.log(`  paid ${paid.toFixed(2)} of ${m(inv.totalAmount)}`);
}
main().finally(() => prisma.$disconnect());
