import { prisma } from "../src/lib/prisma";
import { computeInvoiceTotals } from "../src/server/billing/calc";

async function main() {
  const inv = await prisma.invoice.findUnique({
    where: { receiptNo: "JMH20261799" },
    include: { items: true, payments: true },
  });

  if (!inv) return;

  const lines = inv.items.map((i) => ({
    description: i.description,
    qty: i.qty,
    unitPrice: Number(i.unitPrice),
    gstRatePct: Number(i.gstRatePct),
  }));

  const calc = computeInvoiceTotals(lines, Number(inv.discountAmount) || 0);
  console.log("Invoice in DB totalAmount:", inv.totalAmount);
  console.log("Calculated by computeInvoiceTotals:", calc);
}

main().catch(console.error).finally(() => prisma.$disconnect());
