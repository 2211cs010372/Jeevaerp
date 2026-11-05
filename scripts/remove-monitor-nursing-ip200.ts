import { prisma } from "../src/lib/prisma";
import { removeAdmissionCharge } from "../src/server/services/ipd.service";

const IP = "JMH2026IP00200";
const APPLY = process.env.APPLY === "1";

async function main() {
  const actor = await prisma.user.findFirst({
    where: { role: { in: ["ADMIN", "SUPERUSER"] } },
    select: { id: true, name: true, role: true }
  });
  if (!actor) throw new Error("No ADMIN/SUPERUSER found");

  const adm = await prisma.admission.findFirstOrThrow({
    where: { ipNumber: IP },
    include: {
      charges: { orderBy: { createdAt: "asc" } },
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        include: { items: true, payments: true }
      }
    }
  });

  const inv = adm.invoices[0];
  if (!inv) throw new Error("No IPD invoice found");

  console.log(`Admission: ${adm.ipNumber} (${adm.status})`);
  console.log(`Current Invoice: ${inv.receiptNo} | Total: ₹${inv.totalAmount} | Status: ${inv.status}`);

  // Find the exact charges:
  // 1. Monitor Charges 3 @ 1000 created at ~05:39 UTC (id: cmvlyyqae0005l108voo3pfa2)
  // 2. Nursing Charges 1 @ 0 created at ~05:40 UTC (id: cmvlyzdhp0001l608yknsou2d)
  const monitorCharge = adm.charges.find(c => c.id === "cmvlyyqae0005l108voo3pfa2" || (c.description === "Monitor Charges" && Number(c.unitPrice) === 1000 && c.createdAt.toISOString().includes("2026-10-24T05:39")));
  const nursingChargeZero = adm.charges.find(c => c.id === "cmvlyzdhp0001l608yknsou2d" || (c.description === "Nursing Charges" && Number(c.unitPrice) === 0));

  if (!monitorCharge) throw new Error("Target Monitor Charges (3 @ 1000 from 24-10-2026 11:09 AM) not found");
  if (!nursingChargeZero) throw new Error("Target Nursing Charges (1 @ 0 from 24-10-2026 11:10 AM) not found");

  console.log("Found Monitor Charge to remove:", {
    id: monitorCharge.id,
    desc: monitorCharge.description,
    qty: monitorCharge.qty,
    price: monitorCharge.unitPrice.toString(),
    createdAt: monitorCharge.createdAt
  });

  console.log("Found Nursing Charge to remove:", {
    id: nursingChargeZero.id,
    desc: nursingChargeZero.description,
    qty: nursingChargeZero.qty,
    price: nursingChargeZero.unitPrice.toString(),
    createdAt: nursingChargeZero.createdAt
  });

  const reduction = Number(monitorCharge.unitPrice) * monitorCharge.qty + Number(nursingChargeZero.unitPrice) * nursingChargeZero.qty;
  const expectedNewTotal = Number(inv.totalAmount) - reduction;
  console.log(`Total reduction: ₹${reduction}`);
  console.log(`Expected new invoice total: ₹${expectedNewTotal}`);

  if (!APPLY) {
    console.log("\n[DRY RUN] Set APPLY=1 to execute.");
    return;
  }

  const ctx = { userAgent: "scripts/remove-monitor-nursing-ip200.ts" };

  console.log("\nRemoving duplicate Monitor Charges...");
  await removeAdmissionCharge(actor as any, monitorCharge.id, ctx);

  console.log("Removing ₹0 Nursing Charges...");
  await removeAdmissionCharge(actor as any, nursingChargeZero.id, ctx);

  const updatedInv = await prisma.invoice.findUniqueOrThrow({
    where: { id: inv.id },
    include: { items: true, payments: true }
  });

  console.log("\n=== UPDATED INVOICE ===");
  console.log({
    receiptNo: updatedInv.receiptNo,
    subtotal: updatedInv.subtotal.toString(),
    discountAmount: updatedInv.discountAmount.toString(),
    totalAmount: updatedInv.totalAmount.toString(),
    status: updatedInv.status,
    paidAt: updatedInv.paidAt
  });
  console.log("Items:");
  updatedInv.items.forEach(it => {
    console.log(` - ${it.description} | qty: ${it.qty} | unitPrice: ${it.unitPrice} | amount: ${it.amount}`);
  });
  console.log("Payments:");
  updatedInv.payments.forEach(p => {
    console.log(` - ${p.id} | ${p.mode} | amount: ${p.amount} | createdAt: ${p.createdAt}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
