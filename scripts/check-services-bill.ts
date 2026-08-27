/**
 * READ-ONLY. The IP services bill for a stay, as the sheet would print it.
 *
 * Nothing is written. Pass IP=<ip number> to pick a stay, or leave it and the
 * most recent self-paying stay with charges on it is used.
 */
import { prisma } from "../src/lib/prisma";
import { ipServicesBillData } from "../src/server/services/ipd.service";

const m = (v: string) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });

async function main() {
  const ip = process.env.IP;
  const adm = ip
    ? await prisma.admission.findFirstOrThrow({ where: { ipNumber: ip }, select: { id: true, ipNumber: true, payerType: true } })
    : await prisma.admission.findFirstOrThrow({
        where: { payerType: "SELF_PAY" },
        orderBy: { admittedAt: "desc" },
        select: { id: true, ipNumber: true, payerType: true },
      });

  const b = await ipServicesBillData(adm.id);
  console.log(`\n${b.admission.ipNumber}  ${b.patient.fullName}  bill ${b.billNo}`);
  console.log(`eligible=${b.eligible}  basis=${b.basis}`);
  console.log(`  ${b.eligibilityNote}\n`);

  for (const g of b.groups) {
    console.log(
      `  ${g.title.padEnd(32)} ${g.bucket.padEnd(9)} ${g.discountable ? "discountable" : "at cost     "}` +
      ` total ${m(g.total).padStart(12)}  (${g.lines.length} lines)`
    );
    const marked = g.lines.filter((l) => l.paidStatus).length;
    if (marked) console.log(`      ${marked} of them carry a paid marker`);
  }

  const x = b.money;
  console.log("\n  head            gross        discount        paid         due");
  for (const [k, v] of [["services", x.services], ["lab", x.lab], ["pharmacy", x.pharmacy]] as const) {
    console.log(`  ${k.padEnd(10)} ${m(v.gross).padStart(12)} ${m(v.discount).padStart(12)} ${m(v.paid).padStart(12)} ${m(v.due).padStart(12)}${v.settled && Number(v.paid) > 0 ? "  PAID" : ""}`);
  }
  console.log(`\n  gross            ${m(x.gross)}`);
  console.log(`  discount         ${m(x.discount)}${Number(x.discountUnapplied) > 0 ? `  (${m(x.discountUnapplied)} could not be applied)` : ""}`);
  console.log(`  gst              ${m(x.gst)}`);
  console.log(`  net bill         ${m(x.netBill)}`);
  console.log(`  already paid     ${m(x.paidTotal)}`);
  console.log(`  advance applied  ${m(x.advanceApplied)} of ${m(x.advance)}`);
  console.log(`  BALANCE PAYABLE  ${m(x.netPayable)}`);
  if (Number(x.refundDue) > 0) console.log(`  refund due       ${m(x.refundDue)}`);

  // The deposit is applied as a payment on the stay's own invoice, so a payment
  // list built naively carries it twice. The column has to add up to what the
  // totals block deducts, or the sheet argues with itself.
  const listed = b.payments.reduce((t, p) => t + Number(p.amount), 0);
  console.log(`
  payment details rows: ${b.payments.length}, listing ${m(listed.toFixed(2))}`);
  console.log(`  paid + advance     : ${m((Number(x.paidTotal) + Number(x.advance)).toFixed(2))}`);

  // The arithmetic the sheet prints has to close, or the paper is wrong.
  const closes =
    Math.abs(Number(x.netBill) - Number(x.paidTotal) - Number(x.advanceApplied) - Number(x.netPayable)) < 0.02;
  console.log(`\n  net − paid − advance = payable ?  ${closes ? "yes" : "NO — the sheet does not add up"}`);
}

main().finally(() => prisma.$disconnect());
