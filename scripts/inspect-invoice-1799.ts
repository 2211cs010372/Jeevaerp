import { prisma } from "../src/lib/prisma";

async function main() {
  const inv = await prisma.invoice.findUnique({
    where: { receiptNo: "JMH20261799" },
    select: {
      id: true,
      receiptNo: true,
      source: true,
      status: true,
      payer: true,
      subtotal: true,
      discountAmount: true,
      taxableAmount: true,
      cgstAmount: true,
      sgstAmount: true,
      totalAmount: true,
      billDate: true,
      createdAt: true,
      paidAt: true,
      notes: true,
      items: true,
      payments: true,
    },
  });
  console.log("Top level invoice fields:", inv);
}

main().catch(console.error).finally(() => prisma.$disconnect());
