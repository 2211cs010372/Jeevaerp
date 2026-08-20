/**
 * REPAIR: admissions that never got their opening BedStay row.
 *
 * A stay's bed used to live only on the Admission - one ward name, one rate, one
 * bed. BedStay was added so a transferred patient could be priced per LEG, and
 * `admitPatient` now opens a leg at admission time: same ward, same rate, same
 * start, no end date. For a stay nobody moves that bills exactly what
 * `days x dailyChargeAtAdmit` billed before, which is why it was safe to add.
 *
 * Admissions created BEFORE that were never backfilled, and they are stuck
 * halfway: the bill falls through to a whole-stay fallback line, and every
 * screen that works per leg has nothing to show. The one people notice is the
 * stay-correction dialog - it lists a row per leg, so a legless stay offers a
 * flat rate box and NO WAY TO EDIT THE DAY COUNT AT ALL. The desk sees the
 * option on one patient and not on the one beside them.
 *
 * WHAT THIS DOES NOT DO: it does not change what anybody is billed. The leg is
 * created from the admission's own snapshot - its ward name, its rate, its GST,
 * its start - so the arithmetic is identical on both sides of the repair. Only
 * the SHAPE changes, from "one stay with a fallback bed" to "one stay with one
 * leg", which is what every stay admitted since already looks like.
 *
 * AN ALREADY-INVOICED STAY IS SKIPPED, loudly. The amount would not move, but
 * the bed line's DESCRIPTION would ("Bed charges - Ward - GW-01 - IP0011 - 4
 * day(s)" becomes "Bed - General Ward BED 1 - 4 days"), and a re-issue after
 * this would hand a family a bill whose wording no longer matches the one they
 * were given. That is a decision for a person, not for a repair script.
 *
 *   npx tsx scripts/backfill-bed-stays.ts             # dry run
 *   EXECUTE=1 npx tsx scripts/backfill-bed-stays.ts   # apply
 */
import { prisma } from "../src/lib/prisma";

const EXECUTE = process.env.EXECUTE === "1";

async function main() {
  const legless = await prisma.admission.findMany({
    where: { bedStays: { none: {} } },
    orderBy: { admittedAt: "asc" },
    select: {
      id: true, ipNumber: true, status: true,
      admittedAt: true, dischargedAt: true,
      bedId: true, admittedById: true,
      wardNameAtAdmit: true, dailyChargeAtAdmit: true, gstRatePctAtAdmit: true,
      bed: { select: { bedNo: true } },
      invoices: {
        where: { source: "IPD", status: { not: "CANCELLED" } },
        select: { receiptNo: true },
      },
    },
  });

  console.log(`\n  Admissions with no BedStay row: ${legless.length}\n`);
  if (!legless.length) {
    console.log("  Nothing to repair.\n");
    await prisma.$disconnect();
    return;
  }

  const plan: typeof legless = [];
  let skipped = 0;

  for (const a of legless) {
    const where = `${a.wardNameAtAdmit} / ${a.bed?.bedNo ?? "bed freed"}`;
    const line = `  ${a.ipNumber.padEnd(16)} ${a.status.padEnd(10)} ${where.padEnd(28)} Rs ${a.dailyChargeAtAdmit}/day`;

    // No bed on the row at all - a legacy discharge that freed it. There is
    // nothing to point a leg AT, and inventing one would put this patient in
    // somebody else's bed for the whole of their stay.
    if (!a.bedId) {
      console.log(`${line}   SKIPPED - no bed on the admission`);
      skipped++;
      continue;
    }
    if (a.invoices.length) {
      console.log(`${line}   SKIPPED - already invoiced (${a.invoices.map((i) => i.receiptNo).join(", ")})`);
      skipped++;
      continue;
    }
    console.log(`${line}   -> one leg from ${a.admittedAt.toISOString().slice(0, 16).replace("T", " ")}`);
    plan.push(a);
  }

  console.log(`\n  ${plan.length} to repair, ${skipped} skipped.`);
  if (!EXECUTE) {
    console.log("  DRY RUN - nothing written. Re-run with EXECUTE=1 to apply.\n");
    await prisma.$disconnect();
    return;
  }

  for (const a of plan) {
    await prisma.bedStay.create({
      data: {
        admissionId: a.id,
        bedId: a.bedId!,
        // The admission's OWN snapshot, not the ward's price today. A ward
        // repriced since this patient was admitted must not have that new rate
        // reach back onto nights already lived.
        wardName: a.wardNameAtAdmit,
        dailyCharge: a.dailyChargeAtAdmit,
        gstRatePct: a.gstRatePctAtAdmit,
        fromDate: a.admittedAt,
        // A stay still running has an open leg; a closed one ends where it ended.
        toDate: a.dischargedAt,
        // Whoever admitted them. This is a repair of a missing row, not somebody
        // moving a patient, and attributing it to whoever ran the script would
        // put a name on a transfer that never happened.
        movedById: a.admittedById,
        reason: "Opening bed leg, backfilled - this stay predates BedStay",
      },
    });
    console.log(`  written: ${a.ipNumber}`);
  }

  console.log(`\n  Done. ${plan.length} leg(s) created.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
