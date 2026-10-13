import { prisma } from "../src/lib/prisma";

async function main() {
  const invs = await prisma.invoice.findMany({
    where: { billDate: { not: null } },
    select: { receiptNo: true, billDate: true, createdAt: true, paidAt: true },
    take: 10,
  });
  console.log("Invoices with billDate:", invs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
