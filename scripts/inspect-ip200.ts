import { prisma } from "../src/lib/prisma";

async function main() {
  const inv = await prisma.invoice.findFirst({
    where: { receiptNo: "JMH20264717" },
    include: { items: true, payments: true }
  });
  console.log("Subtotal:", inv?.subtotal, "Total:", inv?.totalAmount);
  let sum = 0;
  for (const it of inv?.items || []) {
    console.log(`${it.description} | qty: ${it.qty} | unitPrice: ${it.unitPrice} | amount: ${it.amount}`);
    sum += Number(it.amount);
  }
  console.log("Sum of items:", sum);

  console.log("\n=== AUDIT LOGS FOR ADMISSION ===");
  const adm = await prisma.admission.findFirst({ where: { ipNumber: "JMH2026IP00200" } });
  if (adm) {
    const logs = await prisma.auditLog.findMany({
      where: {
        OR: [
          { targetId: adm.id },
          { targetId: inv?.id }
        ]
      },
      orderBy: { createdAt: "asc" }
    });
    logs.forEach(l => {
      console.log(`[${l.createdAt.toISOString()}] ${l.action} | meta: ${JSON.stringify(l.meta)}`);
    });
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
