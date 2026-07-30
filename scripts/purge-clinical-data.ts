/**
 * PRE-LAUNCH RESET. Deletes every patient, doctor, non-admin staff account and
 * all pharmacy stock from the database, so the hospital starts from a clean
 * slate with only admins able to sign in.
 *
 * WHAT IT DELETES
 *   patients                and every appointment, visit, vitals, prescription,
 *                           lab test, admission, invoice, payment, refund and
 *                           insurance claim attached to them
 *   doctors                 profiles, schedules, bookable slots, callback requests
 *   staff users             every User whose role is not ADMIN
 *   pharmacy                medicines, stock batches, stock transactions,
 *                           suppliers, purchase orders, goods receipts, returns
 *   operational logs        audit log, OTPs, refresh tokens, sessions, login
 *                           attempts, error log
 *
 * WHAT IT KEEPS
 *   admins                  every User whose role is ADMIN
 *   wards and beds          reset to AVAILABLE, since their occupants are gone
 *   lab test catalogue      and its analyte reference ranges
 *   hospital config         GSTIN, branding, behaviour switches
 *   counters                reset to 0 so the first new patient is …OP00001
 *
 * THIS IS NOT REVERSIBLE. Take a backup first:
 *
 *   npm run backup
 *   npx tsx scripts/purge-clinical-data.ts --dry-run
 *   npx tsx scripts/purge-clinical-data.ts --yes
 *
 * --dry-run counts what would go without touching anything. Run it first: the
 * numbers it prints are the ones you are about to lose.
 */
import { PrismaClient } from "@prisma/client";
import readline from "readline";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const CONFIRMED = args.has("--yes");

/** Deletion order matters: children before parents, or Restrict FKs abort it. */
async function counts() {
  const [
    patients, doctors, staff, admins, appointments, invoices, payments,
    labTests, prescriptions, admissions, medicines, batches, suppliers, claims,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.doctor.count(),
    prisma.user.count({ where: { role: { not: "ADMIN" } } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.appointment.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
    prisma.labTest.count(),
    prisma.prescription.count(),
    prisma.admission.count(),
    prisma.medicine.count(),
    prisma.stockBatch.count(),
    prisma.supplier.count(),
    prisma.insuranceClaim.count(),
  ]);
  return { patients, doctors, staff, admins, appointments, invoices, payments, labTests, prescriptions, admissions, medicines, batches, suppliers, claims };
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim() === "DELETE";
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  // Show the host, never the password.
  const host = url.replace(/\/\/[^@]*@/, "//***@").split("?")[0];

  const before = await counts();

  console.log("\n  Target database: " + host);
  console.log("\n  Currently in the database:");
  console.log(`     patients          ${before.patients}`);
  console.log(`     doctors           ${before.doctors}`);
  console.log(`     non-admin staff   ${before.staff}`);
  console.log(`     appointments      ${before.appointments}`);
  console.log(`     invoices          ${before.invoices}   payments ${before.payments}`);
  console.log(`     lab tests         ${before.labTests}`);
  console.log(`     prescriptions     ${before.prescriptions}`);
  console.log(`     admissions        ${before.admissions}`);
  console.log(`     insurance claims  ${before.claims}`);
  console.log(`     medicines         ${before.medicines}   batches ${before.batches}   suppliers ${before.suppliers}`);
  console.log(`\n     admins KEPT       ${before.admins}`);

  if (before.admins === 0) {
    console.error("\n  ✗ There are no ADMIN users. Purging now would lock everyone out of the");
    console.error("    system with no way back in. Run `npm run seed:admins` first.\n");
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("\n  --dry-run: nothing was deleted.\n");
    return;
  }

  if (!CONFIRMED) {
    console.log("\n  This cannot be undone. Take a backup first: npm run backup");
    const ok = await confirm('  Type DELETE to proceed (anything else aborts): ');
    if (!ok) {
      console.log("\n  Aborted. Nothing was deleted.\n");
      return;
    }
  }

  console.log("\n  Purging…");

  // ---- 1. Leaves of the clinical tree ------------------------------------
  // Each of these points at a patient, an invoice or an admission, so they go
  // before the rows they point at.
  await prisma.claimEvent.deleteMany({});
  await prisma.insuranceClaim.deleteMany({});
  await prisma.refund.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.eInvoice.deleteMany({});
  await prisma.invoiceItem.deleteMany({});
  await prisma.invoice.deleteMany({});
  console.log("     ✓ billing (invoices, payments, refunds, claims, e-invoices)");

  await prisma.labResultItem.deleteMany({});
  await prisma.labTest.deleteMany({});
  console.log("     ✓ lab tests and results (catalogue + analytes kept)");

  await prisma.prescriptionItem.deleteMany({});
  await prisma.prescription.deleteMany({});
  await prisma.prescriptionUploadItem.deleteMany({});
  await prisma.prescriptionUpload.deleteMany({});
  console.log("     ✓ prescriptions and uploads");

  // ---- 2. IPD -------------------------------------------------------------
  await prisma.admissionCharge.deleteMany({});
  await prisma.admissionAdvance.deleteMany({});
  await prisma.bedStay.deleteMany({});
  await prisma.admission.deleteMany({});
  // The wards and beds themselves stay - only their occupancy is cleared.
  await prisma.bed.updateMany({ data: { status: "AVAILABLE" } });
  console.log("     ✓ admissions cleared, every bed set back to AVAILABLE");

  // ---- 3. OPD -------------------------------------------------------------
  await prisma.vitals.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.appointmentRequest.deleteMany({});
  await prisma.doctorSlot.deleteMany({});
  await prisma.doctorSchedule.deleteMany({});
  console.log("     ✓ appointments, callback requests, slots and diaries");

  // ---- 4. Pharmacy --------------------------------------------------------
  // Entered in the pharmacy portal from now on, not seeded.
  await prisma.purchaseReturnItem.deleteMany({});
  await prisma.purchaseReturn.deleteMany({});
  await prisma.goodsReceiptItem.deleteMany({});
  await prisma.goodsReceipt.deleteMany({});
  await prisma.purchaseOrderItem.deleteMany({});
  await prisma.purchaseOrder.deleteMany({});
  await prisma.stockTransaction.deleteMany({});
  await prisma.stockBatch.deleteMany({});
  await prisma.medicine.deleteMany({});
  await prisma.supplier.deleteMany({});
  console.log("     ✓ pharmacy: medicines, batches, suppliers, purchase docs");

  // ---- 5. People ----------------------------------------------------------
  // mergedIntoId is a self-relation with a Restrict action: a merged patient
  // points at its survivor, and deleting the survivor first is refused. Break
  // the links, then the whole table goes in one statement.
  await prisma.patient.updateMany({ where: { mergedIntoId: { not: null } }, data: { mergedIntoId: null } });
  await prisma.patient.deleteMany({});
  console.log("     ✓ patients");

  await prisma.doctor.deleteMany({});
  console.log("     ✓ doctors");

  // ---- 6. Auth + logs -----------------------------------------------------
  // These reference User, so they must clear before non-admin users can go.
  // The audit log goes wholesale: what survives would be a set of entries whose
  // actor no longer exists, which is worse than an empty log.
  await prisma.auditLog.deleteMany({});
  await prisma.otp.deleteMany({});
  await prisma.refreshToken.deleteMany({});
  await prisma.staffSession.deleteMany({});
  await prisma.loginAttempt.deleteMany({});
  await prisma.errorLog.deleteMany({});
  console.log("     ✓ audit log, sessions, tokens, OTPs, error log");

  const removedStaff = await prisma.user.deleteMany({ where: { role: { not: "ADMIN" } } });
  console.log(`     ✓ ${removedStaff.count} non-admin user account(s) removed`);

  // ---- 7. Counters --------------------------------------------------------
  // Left at their old values, the first new patient would be JMH2026OP00042.
  // Zeroed, numbering starts at 1 - which is what a fresh hospital expects.
  const year = new Date().getFullYear();
  await prisma.counter.updateMany({ data: { value: 0 } });
  await prisma.counter.upsert({ where: { key: `PATIENT-${year}` }, update: { value: 0 }, create: { key: `PATIENT-${year}`, value: 0 } });
  console.log("     ✓ counters reset - next patient will be OP00001");

  const after = await counts();
  console.log("\n  Done. Remaining:");
  console.log(`     admins       ${after.admins}   (unchanged)`);
  console.log(`     patients     ${after.patients}`);
  console.log(`     doctors      ${after.doctors}`);
  console.log(`     staff        ${after.staff}`);
  console.log(`     medicines    ${after.medicines}`);

  const [wards, beds, catalog] = await Promise.all([
    prisma.ward.count(), prisma.bed.count(), prisma.labTestCatalog.count(),
  ]);
  console.log(`\n     kept: ${wards} wards · ${beds} beds · ${catalog} lab tests\n`);
  console.log("  Next: sign in as an admin and add doctors and staff from Admin → Staff.");
  console.log("  Pharmacy stock is entered in the pharmacy portal.\n");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
