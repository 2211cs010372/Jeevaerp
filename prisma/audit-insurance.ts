import { PrismaClient } from "@prisma/client";

/**
 * THE INSURANCE BOOK, RECONCILED.
 *
 *   npx tsx prisma/audit-insurance.ts          # report only
 *   npx tsx prisma/audit-insurance.ts --apply  # close stale drafts
 *
 * Two things drift on a cashless stay, and neither one shouts:
 *
 *   BILLS THE CLAIM NEVER COVERED. A claim raised for the discharge bill alone
 *   leaves the stay's lab and pharmacy invoices pointed at an insurer who was
 *   never asked to pay them. They are out of every dues list by design, so
 *   nobody chases them and nobody notices - the hospital simply never gets the
 *   money. This is what the old code did before bills inherited the stay's payer.
 *
 *   PRE-AUTHS THAT NEVER HAPPENED. Every insurance admission opens a ₹0 draft
 *   pre-auth. A desk that goes straight to a final claim leaves it behind, and
 *   it sits on the To raise list for ever asking for an amount nobody will give
 *   it. Newly settled claims now close their own; this cleans up the ones that
 *   were left before that existed.
 *
 * ONLY THE DRAFTS ARE CLOSED, and only with --apply. The unclaimed bills are
 * REPORTED, never touched: the choice between raising a supplementary claim and
 * billing the patient is the hospital's, it depends on what the insurer will
 * still accept, and getting it wrong means either losing the money or charging a
 * family who was promised cashless.
 */
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2 });

async function main() {
  const stays = await prisma.admission.findMany({
    where: { payerType: "INSURANCE" },
    orderBy: { admittedAt: "asc" },
    select: {
      id: true, ipNumber: true, insurer: true, dischargedAt: true,
      patient: { select: { fullName: true } },
      invoices: {
        where: { status: { not: "CANCELLED" }, payer: "INSURANCE" },
        select: { receiptNo: true, source: true, totalAmount: true, payments: { select: { amount: true } } },
      },
    },
  });

  const claims = await prisma.insuranceClaim.findMany({
    select: { id: true, claimNo: true, admissionId: true, stage: true, status: true, claimedAmount: true, settledAmount: true },
  });

  const unclaimed: string[] = [];
  const staleDrafts: { id: string; claimNo: string; ipNumber: string }[] = [];

  for (const s of stays) {
    const mine = claims.filter((c) => c.admissionId === s.id);
    const onClaim = s.invoices.reduce((a, i) => a + Number(i.totalAmount), 0);
    const paidByInsurer = s.invoices.reduce(
      (a, i) => a + i.payments.reduce((x, p) => x + Number(p.amount), 0), 0
    );
    const open = Math.round((onClaim - paidByInsurer) * 100) / 100;

    // A stay still in a bed has not finished accruing - nothing to reconcile yet.
    if (!s.dischargedAt) continue;

    // Money pointed at an insurer that no live claim is asking for. Judged on
    // what is UNPAID rather than on claim arithmetic: a claim can be short and
    // still right (the insurer refused a line), but an open balance with no
    // claim behind it is money nobody has asked anybody for.
    const live = mine.filter((c) => !["REJECTED", "CLOSED"].includes(c.status));
    const asked = live.reduce((a, c) => a + Number(c.claimedAmount), 0);
    if (open > 0.01 && asked + 0.01 < onClaim) {
      unclaimed.push(
        `  ${s.ipNumber}  ${s.patient.fullName} (${s.insurer ?? "-"})\n` +
        `      on the claim ${inr(onClaim)} · insurer paid ${inr(paidByInsurer)} · OPEN ${inr(open)}\n` +
        `      claims ask for ${inr(asked)} → ${inr(Math.round((onClaim - asked) * 100) / 100)} was never claimed\n` +
        s.invoices
          .filter((i) => i.payments.reduce((x, p) => x + Number(p.amount), 0) < Number(i.totalAmount) - 0.01)
          .map((i) => `        ${i.receiptNo}  ${i.source}  ${inr(Number(i.totalAmount))}`)
          .join("\n")
      );
    }

    // A ₹0 pre-auth draft on a stay whose final claim has already gone out.
    const finalGone = mine.some((c) => c.stage === "FINAL" && ["SUBMITTED", "QUERIED", "APPROVED", "PARTIALLY_APPROVED", "SETTLED"].includes(c.status));
    if (finalGone) {
      for (const c of mine) {
        if (c.stage === "PRE_AUTH" && c.status === "DRAFT" && Number(c.claimedAmount) === 0) {
          staleDrafts.push({ id: c.id, claimNo: c.claimNo, ipNumber: s.ipNumber });
        }
      }
    }
  }

  console.log(`\n  ${stays.length} insurance stay(s)\n`);

  console.log(`  ── UNCLAIMED BILLS ──`);
  if (!unclaimed.length) console.log(`  Nothing. Every discharged stay's bills are covered by a claim.\n`);
  else {
    console.log(unclaimed.join("\n") + "\n");
    console.log(`  Not touched by this script. For each one, either:`);
    console.log(`    · raise a supplementary claim for the balance  (Insurance → Claims → New claim), or`);
    console.log(`    · bill the patient  (Insurance → the stay → "Bill the patient instead")\n`);
  }

  console.log(`  ── STALE PRE-AUTH DRAFTS ──`);
  if (!staleDrafts.length) console.log(`  None.\n`);
  else {
    for (const d of staleDrafts) console.log(`  ${apply ? "✓ closed" : "→ would close"}  ${d.claimNo}  (${d.ipNumber})`);
    if (apply) {
      for (const d of staleDrafts) {
        await prisma.insuranceClaim.update({ where: { id: d.id }, data: { status: "CLOSED" } });
      }
      console.log(`\n  ${staleDrafts.length} closed. They will drop off the To raise list.\n`);
    } else {
      console.log(`\n  Re-run with --apply to close them.\n`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
