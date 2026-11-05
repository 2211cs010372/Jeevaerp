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
  console.log("Current payments:", inv.payments.map(p => ({ id: p.id, mode: p.mode, amount: p.amount.toString() })));

  // Identify duplicate charges:
  // Batch 1 (created around 05:38 - 05:40)
  // Batch 2 (created around 09:04 - 09:05)
  // Let's find the second Doctor Consultation and second DMO charges:
  const docCharges = adm.charges.filter(c => c.description.toLowerCase().includes("doctor consultation"));
  const dmoCharges = adm.charges.filter(c => c.description.toLowerCase().includes("dmo"));

  console.log("\nDoctor consultation charges found:", docCharges.map(c => ({ id: c.id, desc: c.description, qty: c.qty, price: c.unitPrice.toString(), createdAt: c.createdAt })));
  console.log("DMO charges found:", dmoCharges.map(c => ({ id: c.id, desc: c.description, qty: c.qty, price: c.unitPrice.toString(), createdAt: c.createdAt })));

  if (docCharges.length !== 2) {
    throw new Error(`Expected 2 Doctor Consultation charges, found ${docCharges.length}`);
  }
  if (dmoCharges.length !== 2) {
    throw new Error(`Expected 2 DMO charges, found ${dmoCharges.length}`);
  }

  // We want to remove the duplicate ones (the second batch):
  const docToRemove = docCharges[1]; // cmvm6a6an0007l808wew4jk6o
  const dmoToRemove = dmoCharges[1]; // cmvm6amdp000bl80842uvxcmk

  console.log(`\nWill remove duplicate Doctor Consultation: ${docToRemove.id} (${docToRemove.qty} x ₹${docToRemove.unitPrice} = ₹${Number(docToRemove.unitPrice) * docToRemove.qty})`);
  console.log(`Will remove duplicate DMO: ${dmoToRemove.id} (${dmoToRemove.qty} x ₹${dmoToRemove.unitPrice} = ₹${Number(dmoToRemove.unitPrice) * dmoToRemove.qty})`);

  const reduction = (Number(docToRemove.unitPrice) * docToRemove.qty) + (Number(dmoToRemove.unitPrice) * dmoToRemove.qty);
  const expectedNewTotal = Number(inv.totalAmount) - reduction;
  console.log(`Total reduction: ₹${reduction}`);
  console.log(`Expected new invoice total: ₹${expectedNewTotal}`);

  if (!APPLY) {
    console.log("\n[DRY RUN] Set APPLY=1 to execute the change.");
    return;
  }

  const ctx = { userAgent: "scripts/recorrect-ip200.ts" };

  console.log("\nRemoving duplicate Doctor Consultation...");
  await removeAdmissionCharge(actor as any, docToRemove.id, ctx);

  console.log("Removing duplicate DMO charges...");
  await removeAdmissionCharge(actor as any, dmoToRemove.id, ctx);

  // Inspect invoice after update
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
