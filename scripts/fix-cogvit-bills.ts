/**
 * CORRECT the COGVIT-ALL lines on JMH20260567 and JMH20260619.
 *
 * The batch was booked with packSize 1 (the pack label "1*15" is not one
 * parsePack can read), so the per-strip MRP of 199 was charged per tablet. Both
 * patients were handed one strip - fifteen tablets - each time, and billed as if
 * for fifteen strips. On JMH20260619 the second dispense was also keyed as qty
 * 12 instead of 15, and that line carries 0% GST where the identical product on
 * the same bill carries 5%.
 *
 * NO REFUND ROW IS WRITTEN. Both bills are settled in full, so correcting them
 * downward leaves more money collected than the bill now asks for - Rs 2,925.23
 * on one and Rs 5,114.20 on the other. `updateInvoice` refuses this edit for
 * exactly that reason (assertTotalCoversCollected). It is being made anyway, on
 * instruction, and the audit row written below is the only record that the gap
 * exists: the day close will still count the full cash and UPI that was taken.
 *
 * Line arithmetic, status derivation and the wholesale item swap follow
 * updateInvoice, so a bill corrected here and a bill corrected at the desk
 * cannot disagree. Unlike that path, batchId is preserved - it is the only link
 * from a bill line back to the stock it came off, and losing it on an edit is
 * why the lines on JMH20260619 already trace to nothing.
 *
 *   npx tsx scripts/fix-cogvit-bills.ts             # dry run
 *   EXECUTE=1 npx tsx scripts/fix-cogvit-bills.ts   # apply
 */
import { prisma } from "../src/lib/prisma";
import { r2, netPaid, invoiceStatusFrom } from "../src/server/billing/calc";
import { perUnitPrice } from "../src/lib/pharmacy/pack";

const EXECUTE = process.env.EXECUTE === "1";

/** One strip of 15, priced off the printed MRP of 199 a strip. */
const QTY = 15;
const UNIT_PRICE = perUnitPrice(199, 15);
const GST = 5;
const HSN = "21069099";

/** Exactly what each COGVIT line must look like now, or this is the wrong bill. */
const EXPECT: Record<string, { qty: number; unitPrice: number; gstRatePct: number }[]> = {
  JMH20260567: [{ qty: 15, unitPrice: 199, gstRatePct: 5 }],
  JMH20260619: [{ qty: 15, unitPrice: 199, gstRatePct: 5 }, { qty: 12, unitPrice: 199, gstRatePct: 0 }],
};

const isCogvit = (d: string) => d.toUpperCase().includes("COGVIT");

async function main() {
  console.log(`COGVIT-ALL -> ${QTY} tablets x Rs ${UNIT_PRICE.toFixed(2)} = Rs ${r2(QTY * UNIT_PRICE).toFixed(2)}, GST ${GST}%, HSN ${HSN}\n`);

  for (const receiptNo of Object.keys(EXPECT)) {
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { receiptNo },
      select: {
        id: true, receiptNo: true, status: true, discountAmount: true, totalAmount: true,
        patient: { select: { fullName: true } },
        items: {
          orderBy: { id: "asc" },
          select: { id: true, description: true, hsnSac: true, qty: true, unitPrice: true,
                    amount: true, gstRatePct: true, batchId: true, labTestId: true },
        },
        payments: { select: { amount: true } },
        refunds: { select: { amount: true } },
        eInvoice: { select: { status: true } },
      },
    });

    const cogvit = inv.items.filter((i) => isCogvit(i.description));
    const want = EXPECT[receiptNo];

    // ---- guards -----------------------------------------------------------
    const bad: string[] = [];
    if (inv.status === "CANCELLED") bad.push("bill is CANCELLED");
    // A live IRN means these figures were filed with the IRP and printed under a
    // QR. Correcting that is a credit note, not an edit, whatever the instruction.
    if (inv.eInvoice?.status === "GENERATED") bad.push("bill carries a GENERATED e-invoice IRN - only a credit note can correct it");
    if (cogvit.length !== want.length) bad.push(`${cogvit.length} COGVIT line(s), expected ${want.length}`);
    else cogvit.forEach((it, n) => {
      const w = want[n];
      if (it.qty !== w.qty) bad.push(`line ${n + 1} qty is ${it.qty}, expected ${w.qty}`);
      if (Number(it.unitPrice) !== w.unitPrice) bad.push(`line ${n + 1} rate is ${Number(it.unitPrice).toFixed(2)}, expected ${w.unitPrice}`);
      if (Number(it.gstRatePct) !== w.gstRatePct) bad.push(`line ${n + 1} gst is ${Number(it.gstRatePct)}%, expected ${w.gstRatePct}%`);
    });
    if (bad.length) { console.log(`${receiptNo} REFUSED:\n  ${bad.join("\n  ")}\n`); continue; }

    // ---- recompute, exactly as updateInvoice does --------------------------
    const lines = inv.items.map((i) => {
      const hit = isCogvit(i.description);
      const qty = hit ? QTY : i.qty;
      const unitPrice = hit ? UNIT_PRICE : Number(i.unitPrice);
      return {
        description: i.description, hsnSac: hit ? HSN : i.hsnSac, qty, unitPrice,
        amount: r2(qty * unitPrice), gstRatePct: hit ? GST : Number(i.gstRatePct),
        batchId: i.batchId, labTestId: i.labTestId, hit,
        was: { qty: i.qty, unitPrice: Number(i.unitPrice), amount: Number(i.amount), gst: Number(i.gstRatePct), hsn: i.hsnSac },
      };
    });

    let subtotal = 0;
    for (const l of lines) subtotal = r2(subtotal + l.amount);
    const discount = r2(Number(inv.discountAmount));
    const ratio = subtotal > 0 ? discount / subtotal : 0;
    let taxable = 0, cgst = 0, sgst = 0;
    for (const l of lines) {
      const after = r2(l.amount * (1 - ratio));
      taxable = r2(taxable + after);
      const tax = r2((after * l.gstRatePct) / 100);
      cgst = r2(cgst + tax / 2);
      sgst = r2(sgst + tax / 2);
    }
    const total = r2(taxable + cgst + sgst);

    const payments = inv.payments.map((p) => ({ amount: Number(p.amount) }));
    const refunds = inv.refunds.map((x) => ({ amount: Number(x.amount) }));
    const collected = netPaid(payments, refunds);
    const status = invoiceStatusFrom(total, payments, refunds);
    const over = r2(collected - total);

    console.log(`${receiptNo}  ${inv.patient.fullName}  ${inv.status} -> ${status}`);
    for (const l of lines.filter((x) => x.hit)) {
      console.log(`   ${l.description.slice(0, 46)}`);
      console.log(`     qty ${l.was.qty} -> ${l.qty}    rate ${l.was.unitPrice.toFixed(2)} -> ${l.unitPrice.toFixed(2)}    `
                + `amount ${l.was.amount.toFixed(2)} -> ${l.amount.toFixed(2)}    gst ${l.was.gst}% -> ${l.gstRatePct}%    hsn ${l.was.hsn ?? "-"} -> ${l.hsnSac}`);
    }
    console.log(`   total ${Number(inv.totalAmount).toFixed(2)} -> ${total.toFixed(2)}    collected ${collected.toFixed(2)}`);
    console.log(`   LEFT OVER-COLLECTED BY ${over.toFixed(2)} - no Refund row written, by instruction\n`);

    if (!EXECUTE) continue;

    const actor = await prisma.user.findFirst({ where: { role: "ADMIN", email: "mallesh@gmail.com" }, select: { id: true, email: true } })
               ?? await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, email: true } });
    if (!actor) throw new Error("No ADMIN user to attribute the correction to");

    await prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          subtotal: subtotal.toFixed(2), discountAmount: discount.toFixed(2), taxableAmount: taxable.toFixed(2),
          cgstAmount: cgst.toFixed(2), sgstAmount: sgst.toFixed(2), totalAmount: total.toFixed(2), status,
          items: {
            create: lines.map((l) => ({
              description: l.description, hsnSac: l.hsnSac, qty: l.qty,
              unitPrice: l.unitPrice.toFixed(2), amount: l.amount.toFixed(2), gstRatePct: l.gstRatePct.toFixed(2),
              batchId: l.batchId, labTestId: l.labTestId,
            })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actor.id, action: "INVOICE_EDITED_AFTER_PAYMENT", targetTable: "Invoice", targetId: inv.id,
          meta: {
            receiptNo: inv.receiptNo,
            oldTotal: Number(inv.totalAmount).toFixed(2),
            newTotal: total.toFixed(2),
            collected: collected.toFixed(2),
            status,
            source: "fix-cogvit-bills script",
            reason: `COGVIT-ALL batch T260849 was booked with packSize 1 (pack label "1*15" unreadable), so MRP 199 - a `
                  + `per-strip figure - was charged per tablet. Corrected to ${QTY} tablets at Rs ${UNIT_PRICE.toFixed(2)} a tablet. `
                  + `On JMH20260619 the second dispense was also keyed as qty 12 instead of 15 and carried 0% GST.`,
            overCollected: over.toFixed(2),
            overCollectedNote: `Rs ${over.toFixed(2)} more has been collected on this bill than it now asks for. No Refund row `
                             + `was written, on instruction, so that money stays in the takings for the day it was received `
                             + `and this audit entry is the only record that it is owed back to the patient.`,
          },
        },
      });
    });
    console.log(`   applied, posted as ${actor.email}\n`);
  }

  if (!EXECUTE) { console.log("DRY RUN - nothing written. Set EXECUTE=1 to apply."); return; }

  console.log("=== VERIFY ===");
  for (const receiptNo of Object.keys(EXPECT)) {
    const inv = await prisma.invoice.findUniqueOrThrow({
      where: { receiptNo },
      select: {
        receiptNo: true, status: true, subtotal: true, cgstAmount: true, sgstAmount: true, totalAmount: true,
        items: { select: { description: true, qty: true, unitPrice: true, amount: true, gstRatePct: true, batchId: true } },
        payments: { select: { amount: true } }, refunds: { select: { amount: true } },
      },
    });
    const sum = inv.items.reduce((s, i) => s + Number(i.amount), 0);
    const collected = netPaid(inv.payments.map((p) => ({ amount: Number(p.amount) })), inv.refunds.map((x) => ({ amount: Number(x.amount) })));
    console.log(`  ${inv.receiptNo}  ${inv.status}  ${inv.items.length} lines  subtotal ${Number(inv.subtotal).toFixed(2)} `
              + `(lines add to ${sum.toFixed(2)} ${r2(sum) === r2(Number(inv.subtotal)) ? "OK" : "!! MISMATCH"})  `
              + `total ${Number(inv.totalAmount).toFixed(2)}  collected ${collected.toFixed(2)}  owed back ${r2(collected - Number(inv.totalAmount)).toFixed(2)}`);
    for (const i of inv.items.filter((x) => isCogvit(x.description))) {
      console.log(`     ${i.description.slice(0, 40)}  qty=${i.qty} x ${Number(i.unitPrice).toFixed(2)} = ${Number(i.amount).toFixed(2)}  gst=${Number(i.gstRatePct)}%  batch ${i.batchId ? "linked" : "not linked"}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
