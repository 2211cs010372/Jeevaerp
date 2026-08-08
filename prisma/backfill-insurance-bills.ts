import { PrismaClient } from "@prisma/client";

/**
 * BACKFILL: bills raised against an insurance stay before those bills knew how
 * to inherit its payer.
 *
 *   npx tsx prisma/backfill-insurance-bills.ts          # report only
 *   npx tsx prisma/backfill-insurance-bills.ts --apply  # write
 *
 * The pharmacy and the lab raise their own invoices for an inpatient and link
 * them to the admission. They had no way to know the stay was cashless, so every
 * one of them was written as SELF_PAY: the family was asked for them at
 * discharge, and the insurer was never billed for them at all. createInvoice now
 * inherits the payer from the admission, which fixes everything raised from here
 * on; this fixes what is already in the table.
 *
 * ONLY UNPAID BILLS ARE TOUCHED, and that restriction is the whole safety
 * argument. If money was actually taken across a counter for a bill, then it WAS
 * settled by the patient, whatever the stay's payer says - relabelling it would
 * move real cash out of the day close it was counted in and invent a claim
 * against an insurer for money the hospital already has. A part-paid bill is
 * left alone for the same reason and reported for a human.
 *
 * Reports by default. Pass --apply to write.
 */
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const stays = await prisma.admission.findMany({
    where: { payerType: "INSURANCE" },
    select: { id: true, ipNumber: true, insurer: true },
  });
  if (stays.length === 0) {
    console.log("\n  No insurance stays. Nothing to do.\n");
    return;
  }
  const insurerOf = new Map(stays.map((s) => [s.id, s.insurer]));
  const ipOf = new Map(stays.map((s) => [s.id, s.ipNumber]));

  const bills = await prisma.invoice.findMany({
    where: {
      admissionId: { in: stays.map((s) => s.id) },
      source: { in: ["PHARMACY", "LAB", "OTHER"] },
      payer: "SELF_PAY",
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, source: true, totalAmount: true, admissionId: true,
      payments: { select: { amount: true } },
      patient: { select: { fullName: true } },
    },
  });

  console.log(`\n  ${stays.length} insurance stay(s) · ${bills.length} self-pay bill(s) against them\n`);

  let moved = 0, held = 0;
  for (const b of bills) {
    const paid = b.payments.reduce((s, p) => s + Number(p.amount), 0);
    const label = `${b.source.padEnd(9)} ${b.receiptNo}  ₹${Number(b.totalAmount).toFixed(2).padStart(10)}  ${ipOf.get(b.admissionId!)}  ${b.patient.fullName}`;

    if (paid > 0) {
      console.log(`  · HELD  ${label}   (₹${paid.toFixed(2)} already taken at a counter)`);
      held++;
      continue;
    }
    if (apply) {
      await prisma.invoice.update({
        where: { id: b.id },
        data: { payer: "INSURANCE", payerName: insurerOf.get(b.admissionId!) ?? null },
      });
    }
    console.log(`  ${apply ? "✓ MOVED" : "→ would move"} ${label}`);
    moved++;
  }

  console.log(
    `\n  ${moved} ${apply ? "moved to the insurer" : "would move"} · ${held} left alone (money already taken)\n` +
    (apply ? "" : "  Nothing written. Re-run with --apply to write.\n")
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
