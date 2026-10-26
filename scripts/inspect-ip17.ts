/** READ-ONLY. One stay: ward legs, rates, the IPD invoice and its payments, and the ward list. */
import { prisma } from "../src/lib/prisma";
const IP = process.env.IP ?? "JMH2026IP00017";

async function main() {
  const a = await prisma.admission.findFirstOrThrow({
    where: { ipNumber: IP },
    select: {
      id: true, ipNumber: true, status: true, admittedAt: true, dischargedAt: true,
      dailyChargeAtAdmit: true, wardNameAtAdmit: true, gstRatePctAtAdmit: true, nursePerDay: true,
      patient: { select: { fullName: true, displayId: true } },
      bed: { select: { bedNo: true, ward: { select: { name: true } } } },
      bedStays: { orderBy: { fromDate: "asc" }, select: { id: true, wardName: true, dailyCharge: true, gstRatePct: true, fromDate: true, toDate: true, billedDays: true, bed: { select: { bedNo: true, ward: { select: { name: true } } } } } },
    },
  });
  console.log(JSON.stringify(a, null, 2));
  const invs = await prisma.invoice.findMany({
    where: { admissionId: a.id },
    select: { id: true, receiptNo: true, source: true, status: true, totalAmount: true, createdAt: true,
      items: { select: { description: true, qty: true, unitPrice: true, amount: true, gstRatePct: true } },
      payments: { select: { mode: true, amount: true, createdAt: true } } },
  });
  console.log(JSON.stringify(invs, null, 2));
  const wards = await prisma.ward.findMany({ select: { id: true, name: true, category: true, dailyCharge: true, gstRatePct: true, beds: { select: { id: true, bedNo: true, status: true } } } });
  console.log(JSON.stringify(wards.map(w => ({ ...w, beds: w.beds.map(b => `${b.bedNo}:${b.status}`).join(" ") })), null, 2));
}
main().finally(() => prisma.$disconnect());
