import { prisma } from "../src/lib/prisma";

async function main() {
  const targetDate = new Date("2026-08-30T12:00:00.000Z");

  const inv = await prisma.invoice.findUnique({
    where: { receiptNo: "JMH20261799" },
    include: { payments: true, prescriptionUpload: true },
  });

  console.log("Current inv:", {
    receiptNo: inv?.receiptNo,
    createdAt: inv?.createdAt,
    billDate: inv?.billDate,
    paidAt: inv?.paidAt,
    payments: inv?.payments.map(p => ({ id: p.id, mode: p.mode, amount: p.amount, createdAt: p.createdAt })),
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
