/** READ-ONLY. Every bill for this patient, and any pharmacy line with qty 12 near these dates. */
import { prisma } from "../src/lib/prisma";
const m = (v: unknown) => Number(v).toFixed(2);

async function main() {
  const p = await prisma.patient.findFirstOrThrow({
    where: { fullName: { contains: "MANENDRA", mode: "insensitive" } },
    select: { id: true, fullName: true, displayId: true },
  });
  const invs = await prisma.invoice.findMany({
    where: { patientId: p.id },
    orderBy: { createdAt: "asc" },
    select: { receiptNo: true, source: true, status: true, totalAmount: true, createdAt: true,
              items: { select: { description: true, qty: true, unitPrice: true, amount: true } } },
  });
  console.log(`${p.fullName} (${p.displayId}) - ${invs.length} bill(s)\n`);
  for (const i of invs) {
    console.log(`  ${i.receiptNo}  ${i.createdAt.toISOString().slice(0,16).replace("T"," ")}  ${i.source} ${i.status}  total ${m(i.totalAmount)}`);
    for (const it of i.items) console.log(`     qty=${String(it.qty).padStart(3)} x ${m(it.unitPrice).padStart(8)} = ${m(it.amount).padStart(9)}   ${it.description.slice(0, 60)}`);
    console.log();
  }

  const since = new Date("2026-08-24");
  const twelves = await prisma.invoiceItem.findMany({
    where: { qty: 12, invoice: { source: "PHARMACY", createdAt: { gte: since } } },
    select: { description: true, qty: true, unitPrice: true, amount: true,
              invoice: { select: { receiptNo: true, createdAt: true, status: true, patient: { select: { fullName: true } } } },
              batch: { select: { batchNo: true, packSize: true, pack: true } } },
    orderBy: { invoice: { createdAt: "asc" } },
  });
  console.log(`Pharmacy lines with qty=12 since ${since.toISOString().slice(0,10)}: ${twelves.length}`);
  for (const t of twelves) {
    console.log(`  ${t.invoice.receiptNo}  ${t.invoice.createdAt.toISOString().slice(0,16).replace("T"," ")}  ${t.invoice.patient.fullName}  ${t.invoice.status}`);
    console.log(`     ${t.description.slice(0,60)}  qty=12 x ${m(t.unitPrice)} = ${m(t.amount)}   batch ${t.batch?.batchNo ?? "-"} pack="${t.batch?.pack ?? "-"}" size=${t.batch?.packSize ?? "-"}`);
  }
}
main().finally(() => prisma.$disconnect());
