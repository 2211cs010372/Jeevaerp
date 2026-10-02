import { PrismaClient } from "@prisma/client";

/**
 * MOVE THE MONEY ON BILLS THAT WERE RE-DATED BEFORE THE RULE CHANGED.
 *
 * `Invoice.billDate` began as a PRINTED date only: the sheet moved, the Payment
 * rows kept the day they were keyed in, and the day close counted them there.
 * Since the owner's 2 Oct 2026 rule, `updateInvoice` re-dates a bill's payments
 * along with the bill, so the two agree from the edit onwards.
 *
 * The bills re-dated BEFORE that are still split: the sheet says one day, the
 * collection report another. This brings them into line - every payment on a
 * re-dated bill is stamped with that bill's `billDate`.
 *
 * ── READ THIS BEFORE PASSING --apply ──
 *
 *   IT MOVES CASH BETWEEN CLOSED DAYS. Each payment leaves the day it was keyed
 *   in and lands on the day its bill now carries, so a day close, a collection
 *   report or a till sheet printed earlier will no longer match. On a GST return
 *   already filed, the figure that was filed does not change (the return groups
 *   bills, not payments) - but the cash side of the day it sat in does.
 *
 *   IT IS NOT REVERSIBLE FROM THE DATABASE. The old timestamps exist nowhere
 *   else once overwritten. The dry run prints every row it would touch with its
 *   current timestamp: KEEP THAT OUTPUT. It is the only way back.
 *
 *   `createdAt` ON THE INVOICE IS NOT TOUCHED. The day a bill was actually
 *   raised stays on the row, as it does everywhere else.
 *
 * DRY RUN by default. Pass --apply to write.
 *
 *   npx tsx scripts/align-payments-to-bill-date.ts          # preview
 *   npx tsx scripts/align-payments-to-bill-date.ts --apply  # write
 */

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const dt = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16);
const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

async function main() {
  console.log(
    apply
      ? "\n── APPLYING: payments re-dated onto their bill's corrected date ──\n"
      : "\n── DRY RUN: payments that would move onto their bill's corrected date (pass --apply to write) ──\n",
  );

  const bills = await prisma.invoice.findMany({
    where: { billDate: { not: null }, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, receiptNo: true, source: true, createdAt: true, billDate: true, paidAt: true, status: true,
      payments: { select: { id: true, amount: true, mode: true, createdAt: true } },
    },
  });

  let moved = 0;
  let bothDays = 0;
  const byDay = new Map<string, number>();

  for (const b of bills) {
    const to = b.billDate!;
    const stale = b.payments.filter((p) => p.createdAt.getTime() !== to.getTime());
    if (!stale.length) continue;

    console.log(`${b.receiptNo}  ${b.source}  raised ${dt(b.createdAt)}  →  bill date ${dt(to)}`);
    for (const p of stale) {
      console.log(`    ₹${p.amount.toString()} ${p.mode}  ${dt(p.createdAt)} → ${dt(to)}${day(p.createdAt) === day(to) ? "  (same day - cash does not move)" : ""}`);
      if (day(p.createdAt) !== day(to)) {
        const amt = Number(p.amount.toString());
        byDay.set(day(p.createdAt), (byDay.get(day(p.createdAt)) ?? 0) - amt);
        byDay.set(day(to), (byDay.get(day(to)) ?? 0) + amt);
        bothDays++;
      }
      moved++;
    }

    if (apply) {
      await prisma.payment.updateMany({ where: { id: { in: stale.map((p) => p.id) } }, data: { createdAt: to } });
      // A settled bill was settled on the date it now carries. An unsettled one
      // is left exactly as it is - see updateInvoice.
      if (b.status === "PAID") await prisma.invoice.update({ where: { id: b.id }, data: { paidAt: to } });
    }
  }

  console.log(`\n${bills.length} re-dated bill(s) found · ${moved} payment(s) ${apply ? "moved" : "would move"} · ${bothDays} of them cross a day boundary`);

  if (byDay.size) {
    console.log("\nWhat each day's collection total changes by:");
    for (const d of [...byDay.keys()].sort()) {
      const v = byDay.get(d)!;
      if (Math.abs(v) < 0.01) continue;
      console.log(`  ${d}  ${v > 0 ? "+" : "−"}₹${Math.abs(v).toFixed(2)}`);
    }
  }

  if (!apply && moved) console.log("\nNothing was written. Keep this output - the old timestamps are not stored anywhere else.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
