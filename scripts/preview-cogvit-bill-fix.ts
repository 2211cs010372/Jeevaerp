/** READ-ONLY. What the two COGVIT bills become once the line is priced per unit,
 *  computed with billing's own arithmetic so the figures match what the app would do. */
import { prisma } from "../src/lib/prisma";
import { r2, netPaid } from "../src/server/billing/calc";
import { perUnitPrice } from "../src/lib/pharmacy/pack";

const PER_UNIT = perUnitPrice(199, 15);   // 199 a strip / 15 tablets
const CORRECT_QTY = 15;                   // one strip, both times

async function main() {
  console.log(`COGVIT-ALL corrected price: Rs ${PER_UNIT.toFixed(2)} per tablet (MRP 199 a strip of 15)\n`);
  let owedTotal = 0;

  for (const receiptNo of ["JMH20260567", "JMH20260619"]) {
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { receiptNo },
      select: {
        receiptNo: true, status: true, discountAmount: true, totalAmount: true,
        patient: { select: { fullName: true } },
        items: { select: { description: true, qty: true, unitPrice: true, amount: true, gstRatePct: true } },
        payments: { select: { amount: true, mode: true } },
        refunds: { select: { amount: true } },
      },
    });

    const lines = inv.items.map((i) => {
      const isCogvit = i.description.toUpperCase().includes("COGVIT");
      const qty = isCogvit ? CORRECT_QTY : i.qty;
      const unitPrice = isCogvit ? PER_UNIT : Number(i.unitPrice);
      return { description: i.description, qty, unitPrice, amount: r2(qty * unitPrice),
               gstRatePct: Number(i.gstRatePct), changed: isCogvit, was: { qty: i.qty, unitPrice: Number(i.unitPrice), amount: Number(i.amount) } };
    });

    // Same arithmetic as updateInvoice: proportional discount, tax per line.
    let subtotal = 0;
    for (const l of lines) subtotal = r2(subtotal + l.amount);
    const discount = r2(Number(inv.discountAmount));
    const ratio = subtotal > 0 ? discount / subtotal : 0;
    let taxable = 0, cgst = 0, sgst = 0;
    for (const l of lines) {
      const after = r2(l.amount * (1 - ratio));
      taxable = r2(taxable + after);
      const tax = r2((after * l.gstRatePct) / 100);
      cgst = r2(cgst + tax / 2); sgst = r2(sgst + tax / 2);
    }
    const total = r2(taxable + cgst + sgst);
    const collected = netPaid(inv.payments.map((p) => ({ amount: Number(p.amount) })), inv.refunds.map((x) => ({ amount: Number(x.amount) })));
    const gap = r2(collected - total);
    owedTotal = r2(owedTotal + Math.max(0, gap));

    console.log(`${inv.receiptNo}  ${inv.patient.fullName}  ${inv.status}`);
    for (const l of lines.filter((x) => x.changed)) {
      console.log(`   ${l.description.slice(0, 46)}`);
      console.log(`     ${l.was.qty} x ${l.was.unitPrice.toFixed(2)} = ${l.was.amount.toFixed(2)}   ->   ${l.qty} x ${l.unitPrice.toFixed(2)} = ${l.amount.toFixed(2)}   (gst ${l.gstRatePct}%)`);
    }
    console.log(`   total    ${Number(inv.totalAmount).toFixed(2)}  ->  ${total.toFixed(2)}`);
    console.log(`   collected ${collected.toFixed(2)} (${inv.payments.map((p) => p.mode).join(", ")})`);
    console.log(`   ${gap > 0 ? `OVER-COLLECTED by ${gap.toFixed(2)} - updateInvoice will refuse the edit until this is refunded` : "no gap"}\n`);
  }
  console.log(`Owed back to patients across both bills: Rs ${owedTotal.toFixed(2)}`);
}
main().finally(() => prisma.$disconnect());
