import { prisma } from "../src/lib/prisma";

async function main() {
  const RECEIPT = "JMH20261799";
  const TARGET_DATE = new Date("2026-08-30T12:31:54.000Z");
  const BILL_DATE = new Date("2026-08-30T12:00:00.000Z");

  console.log(`Updating ${RECEIPT} to date: 30-08-2026 (${TARGET_DATE.toISOString()})...`);

  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { receiptNo: RECEIPT },
    include: {
      payments: true,
      prescriptionUpload: true,
    },
  });

  await prisma.$transaction(async (tx) => {
    // 1. Update invoice
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        billDate: BILL_DATE,
        createdAt: TARGET_DATE,
        paidAt: TARGET_DATE,
      },
    });

    // 2. Update all payments to the new date
    for (const p of inv.payments) {
      await tx.payment.update({
        where: { id: p.id },
        data: {
          createdAt: TARGET_DATE,
        },
      });
    }

    // 3. Update prescription upload if attached
    if (inv.prescriptionUploadId) {
      await tx.prescriptionUpload.update({
        where: { id: inv.prescriptionUploadId },
        data: {
          createdAt: TARGET_DATE,
          dispensedAt: TARGET_DATE,
        },
      });
    }

    // 4. Record audit log
    await tx.auditLog.create({
      data: {
        action: "INVOICE_REDATED",
        targetTable: "Invoice",
        targetId: inv.id,
        meta: {
          receiptNo: inv.receiptNo,
          previousCreatedAt: inv.createdAt.toISOString(),
          newDate: TARGET_DATE.toISOString(),
          billDate: BILL_DATE.toISOString(),
          paymentsUpdated: inv.payments.length,
          prescriptionUploadId: inv.prescriptionUploadId,
        },
      },
    });
  });

  console.log("Successfully updated invoice date!");

  // Verify
  const updated = await prisma.invoice.findUnique({
    where: { receiptNo: RECEIPT },
    include: { payments: true, prescriptionUpload: true },
  });

  console.log("\n=== VERIFIED STATE ===");
  console.log(`Receipt: ${updated?.receiptNo}`);
  console.log(`Invoice billDate: ${updated?.billDate?.toISOString()}`);
  console.log(`Invoice createdAt: ${updated?.createdAt?.toISOString()}`);
  console.log(`Invoice paidAt: ${updated?.paidAt?.toISOString()}`);
  console.log("Payments:");
  for (const p of updated?.payments || []) {
    console.log(` - Payment ${p.id} [${p.mode} ₹${p.amount}]: ${p.createdAt.toISOString()}`);
  }
  if (updated?.prescriptionUpload) {
    console.log(`Prescription upload createdAt: ${updated.prescriptionUpload.createdAt.toISOString()}`);
  }
}

main()
  .catch((e) => {
    console.error("Failed to redate:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
