/**
 * JMH2026IP00017: billed as General Ward GW-02 at ₹2,500/day, should have been
 * Special Room. Moves the stay's only bed leg (and the admission) to SPE-05 at
 * ₹4,600/day, re-issues the IPD invoice via correctStayBilling, and records the
 * ₹6,300 difference as cash dated the discharge day (owner, 26 Oct 2026).
 *
 * DRY RUN by default. APPLY=1 to write.
 */
import { prisma } from "../src/lib/prisma";
import { correctStayBilling } from "../src/server/services/ipd.service";
import { recordPayment } from "../src/server/services/billing.service";
import { logAudit } from "../src/server/services/audit.service";

const IP = "JMH2026IP00017";
const WARD = "Special Room";
const BED = "SPE-05";
const RATE = 4600;
const PAID_ON = new Date("2026-08-20T12:00:00.000Z");
const APPLY = process.env.APPLY === "1";

async function main() {
  const actor = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true, name: true, role: true } });
  if (!actor) throw new Error("No ADMIN user to attribute the correction to");

  const a = await prisma.admission.findFirstOrThrow({
    where: { ipNumber: IP },
    select: {
      id: true, status: true, bedId: true, wardNameAtAdmit: true, gstRatePctAtAdmit: true, dailyChargeAtAdmit: true,
      bedStays: { select: { id: true, bedId: true, wardName: true, gstRatePct: true, dailyCharge: true } },
      invoices: { where: { source: "IPD", status: { not: "CANCELLED" } }, select: { id: true, receiptNo: true, totalAmount: true, status: true, paidAt: true, payments: { select: { amount: true } } } },
    },
  });
  if (a.bedStays.length !== 1) throw new Error(`Expected 1 bed leg, found ${a.bedStays.length}`);
  if (a.invoices.length !== 1) throw new Error(`Expected 1 IPD invoice, found ${a.invoices.length}`);
  const leg = a.bedStays[0];
  const inv = a.invoices[0];
  if (leg.wardName !== "General Ward") throw new Error(`Leg is already ${leg.wardName}`);

  const ward = await prisma.ward.findFirstOrThrow({ where: { name: WARD }, select: { id: true, gstRatePct: true } });
  const bed = await prisma.bed.findFirstOrThrow({ where: { wardId: ward.id, bedNo: BED }, select: { id: true } });

  const bedItem = await prisma.invoiceItem.findFirstOrThrow({ where: { invoiceId: inv.id, description: { startsWith: "Bed · General Ward" } }, select: { qty: true } });
  const bedDiff = (RATE - Number(leg.dailyCharge)) * bedItem.qty;
  const paidNow = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
  if (inv.status !== "PAID" || paidNow !== Number(inv.totalAmount)) throw new Error(`Bill not fully paid right now (${inv.status}, ₹${paidNow}/₹${inv.totalAmount})`);

  console.log(`Actor: ${actor.name} (${actor.role})`);
  console.log(`Bed: ${bedItem.qty} days × ₹${RATE - Number(leg.dailyCharge)} = +₹${bedDiff}`);
  console.log(`Before: ${leg.wardName} ₹${leg.dailyCharge}/day · ${inv.receiptNo} ₹${inv.totalAmount} ${inv.status}`);
  console.log(`After:  ${WARD} ${BED} ₹${RATE}/day · re-issue, then +₹ cash dated ${PAID_ON.toISOString()}`);
  if (!APPLY) { console.log("DRY RUN - nothing written. APPLY=1 to write."); return; }

  const ctx = { userAgent: "scripts/fix-ip17-special-room.ts" };

  // 1. The ward and bed. correctStayBilling only moves rates, so this goes first;
  //    its note and the re-issued invoice line then read "Special Room".
  await prisma.$transaction([
    prisma.bedStay.update({ where: { id: leg.id }, data: { wardName: WARD, bedId: bed.id, gstRatePct: ward.gstRatePct } }),
    prisma.admission.update({ where: { id: a.id }, data: { wardNameAtAdmit: WARD, bedId: bed.id, gstRatePctAtAdmit: ward.gstRatePct } }),
  ]);

  // 2. The rate, the ward note, the invoice re-issue and its audit.
  try {
    await correctStayBilling(
      actor, a.id,
      { legs: [{ id: leg.id, dailyCharge: RATE }], reason: `Billed as General Ward GW-02 by mistake; stay was in ${WARD} ${BED}.` },
      ctx,
    );
  } catch (e) {
    await prisma.$transaction([
      prisma.bedStay.update({ where: { id: leg.id }, data: { wardName: leg.wardName, bedId: leg.bedId, gstRatePct: leg.gstRatePct } }),
      prisma.admission.update({ where: { id: a.id }, data: { wardNameAtAdmit: a.wardNameAtAdmit, bedId: a.bedId, gstRatePctAtAdmit: a.gstRatePctAtAdmit } }),
    ]);
    throw e;
  }
  await logAudit(actor, {
    action: "IPD_STAY_WARD_CORRECTED", targetTable: "Admission", targetId: a.id,
    meta: { ipNumber: IP, before: { ward: leg.wardName, bedId: leg.bedId }, after: { ward: WARD, bedNo: BED, bedId: bed.id } },
    ...ctx,
  });

  // 3. The difference, collected in cash on the discharge day.
  //    The desk was editing this bill minutes ago, so the cash is the bed
  //    difference exactly, and only if the total moved by exactly that much.
  const re = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, select: { totalAmount: true, payments: { select: { amount: true } } } });
  const paid = re.payments.reduce((s, p) => s + Number(p.amount), 0);
  const due = Math.round((Number(re.totalAmount) - paid) * 100) / 100;
  console.log(`Re-issued total ₹${re.totalAmount}, paid ₹${paid}, due ₹${due}, expected due ₹${bedDiff}`);
  if (Number(re.totalAmount) !== Number(inv.totalAmount) + bedDiff || due !== bedDiff) {
    throw new Error("Bill moved by something other than the bed change - ward/rate saved, payment NOT recorded. Check before collecting.");
  }
  {
    const before = new Set((await prisma.payment.findMany({ where: { invoiceId: inv.id }, select: { id: true } })).map((p) => p.id));
    await recordPayment(actor, { invoiceId: inv.id, mode: "CASH", amount: due }, ctx);
    const added = (await prisma.payment.findMany({ where: { invoiceId: inv.id }, select: { id: true } })).filter((p) => !before.has(p.id));
    await prisma.$transaction([
      ...added.map((p) => prisma.payment.update({ where: { id: p.id }, data: { createdAt: PAID_ON } })),
      prisma.invoice.update({ where: { id: inv.id }, data: { paidAt: inv.paidAt ?? PAID_ON } }),
    ]);
  }

  const done = await prisma.invoice.findUniqueOrThrow({
    where: { id: inv.id },
    select: { receiptNo: true, totalAmount: true, status: true, paidAt: true, billDate: true,
      items: { select: { description: true, qty: true, unitPrice: true, amount: true } },
      payments: { select: { mode: true, amount: true, createdAt: true } } },
  });
  console.log(JSON.stringify(done, null, 2));
}
main().finally(() => prisma.$disconnect());
