/**
 * DATE-SCOPED PURGE. Deletes hospital records created BEFORE a cutoff date,
 * leaving everything on or after that date standing.
 *
 * This is NOT scripts/purge-clinical-data.ts. That one is the pre-launch reset:
 * it empties the clinical tables wholesale and zeroes the counters, so the
 * hospital restarts at OP00001 with a clean, self-consistent database. This one
 * cuts the history in half and keeps the back half, which is a different and
 * considerably sharper instrument - see THE THREE THINGS IT BREAKS below.
 *
 *   npx tsx scripts/purge-before-date.ts                          # dry run
 *   npx tsx scripts/purge-before-date.ts --before 2026-08-10
 *   npx tsx scripts/purge-before-date.ts --scope billing,labs
 *   npx tsx scripts/purge-before-date.ts --execute                # actually deletes
 *
 * DRY RUN IS THE DEFAULT. Nothing is written unless --execute is passed, and
 * even then you type DELETE at a prompt unless --yes is also given.
 *
 * SCOPES (--scope, comma-separated, default `billing,labs`)
 *   billing    invoices and their items, payments, refunds, e-invoices
 *   labs       lab tests and their result rows (catalogue is never touched)
 *   opd        appointments, vitals, callback requests
 *   ipd        admissions, charges, advances, bed stays
 *   patients   patient records themselves (implies opd, ipd, billing, labs)
 *   staff      non-admin User accounts created before the cutoff
 *
 * THE THREE THINGS IT BREAKS, which a full reset does not:
 *
 *  1. THE GST RECEIPT SERIES GETS HOLES IN IT. Invoice.receiptNo is one
 *     unbroken run of numbers precisely so a GST return reconciles. Deleting
 *     the first N of them leaves a series that starts in the middle, and any
 *     return already filed for those periods no longer has its invoices behind
 *     it. Under Indian GST law those records are retained for years, not weeks.
 *
 *  2. E-INVOICES REGISTERED WITH THE GOVERNMENT OUTLIVE THE LOCAL ROW. An IRN
 *     is the IRP's record, not ours; deleting our copy does not cancel it, it
 *     only destroys the hospital's own proof that the invoice was registered.
 *     The script REFUSES to run if any in-scope invoice has an IRN, unless you
 *     pass --i-understand-gst.
 *
 *  3. MONEY REPORTS STOP RECONCILING BACKWARDS. Day close, collections and the
 *     Tally export all group by Invoice.createdAt. Any period that straddles
 *     the cutoff will report takings that no longer match the drawer, with
 *     nothing on any screen to say why.
 *
 * It also refuses to run while an in-scope admission is still ADMITTED (you
 * would delete a bill for a patient currently in a bed) or an in-scope
 * insurance claim is still unsettled (you would delete the invoice the insurer
 * is being asked to pay). Both can be overridden with --force.
 *
 * TAKE A BACKUP FIRST. `npm run backup` writes an independent copy that
 * restores into any Postgres. This script cannot undo itself.
 */
import { PrismaClient } from "@prisma/client";
import readline from "node:readline";
import path from "node:path";

try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* a real environment passes the variables in directly */
}

/**
 * Session-mode connection, not the transaction pooler. The deletes run inside
 * one interactive transaction that stays open across many statements, which is
 * exactly the shape pgbouncer's transaction pooling is worst at.
 */
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

// ---- Arguments --------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const EXECUTE = flags.has("--execute");
const CONFIRMED = flags.has("--yes");
const FORCE = flags.has("--force");
const GST_ACK = flags.has("--i-understand-gst");

const ALL_SCOPES = ["billing", "labs", "opd", "ipd", "patients", "staff"] as const;
type Scope = (typeof ALL_SCOPES)[number];

const scopeArg = opt("scope") ?? "billing,labs";
const scopes = new Set(scopeArg.split(",").map((s) => s.trim()).filter(Boolean) as Scope[]);
for (const s of scopes) {
  if (!ALL_SCOPES.includes(s)) {
    console.error(`\n  Unknown scope "${s}". Valid: ${ALL_SCOPES.join(", ")}\n`);
    process.exit(1);
  }
}
// Deleting a patient necessarily takes everything hanging off them.
if (scopes.has("patients")) ["opd", "ipd", "billing", "labs"].forEach((s) => scopes.add(s as Scope));

/**
 * Local midnight of the cutoff day. Local, not UTC: `new Date("2026-08-10")`
 * is UTC midnight, which in IST is 05:30 on the 10th - it would take five and a
 * half hours of the 10th's records with it. See src/lib/date.ts.
 */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}
const beforeArg = opt("before");
const now = new Date();
const CUT = beforeArg ? parseLocalDate(beforeArg) : new Date(now.getFullYear(), now.getMonth(), 10, 0, 0, 0, 0);
if (Number.isNaN(CUT.getTime())) {
  console.error("\n  --before must be YYYY-MM-DD\n");
  process.exit(1);
}

/** Every table below is filtered by this and nothing else. */
const before = { createdAt: { lt: CUT } };
/**
 * The same filter applied THROUGH a to-one relation ("the invoice this payment
 * belongs to was created before the cutoff"). Prisma requires the `is:` wrapper
 * on nullable to-one relations and accepts it on required ones, so every
 * relation filter here uses it rather than guessing which is which.
 */
const beforeRel = { is: before };

/**
 * TWO TABLES DO NOT HAVE `createdAt` AND MUST NOT BE ASSUMED TO.
 *
 * An Admission is stamped `admittedAt` and Vitals `recordedAt` - both are the
 * clinically meaningful instant rather than a row-insert time, and neither
 * model carries a createdAt at all. Filtering them by `createdAt` is not a
 * subtle mistake, it is a hard Prisma validation error, which is the only
 * reason this was caught rather than silently matching nothing.
 */
const beforeAdmission = { admittedAt: { lt: CUT } };
const beforeAdmissionRel = { is: beforeAdmission };
const beforeVitals = { recordedAt: { lt: CUT } };

/**
 * A PRE-CUTOFF ROW IS DELETABLE ONLY IF NOTHING THAT SURVIVES STILL POINTS AT IT.
 *
 * The cutoff cuts across relationships, not just rows. A patient registered on
 * the 4th who came back on the 15th has bills on BOTH sides of it: deleting the
 * patient would strand the bill the hospital still needs, and the foreign key
 * refuses it anyway - halfway through the transaction, with an error naming a
 * constraint rather than a reason.
 *
 * So every parent below is "created before the cutoff AND nothing dated on or
 * after it depends on me". Rows that fail the second half are LEFT STANDING and
 * counted, rather than quietly dragging surviving records down with them. That
 * is why the dry run's patient number can be lower than the raw count of
 * patients registered before the cutoff - the difference is the straddlers.
 */
const onOrAfter = { gte: CUT };

const labTestDeletable = {
  ...before,
  // A line on a surviving bill can name a pre-cutoff test as the test it billed.
  // Those tests stay: deleting one would blank the lab line on a bill the
  // hospital is keeping.
  invoiceItems: { none: { invoice: { is: { createdAt: onOrAfter } } } },
};

const appointmentDeletable = {
  ...before,
  invoices: { none: { createdAt: onOrAfter } },
  labTests: { none: { createdAt: onOrAfter } },
  prescriptionUploads: { none: { createdAt: onOrAfter } },
  // Vitals, the prescription and the website booking request are NOT guarded
  // here. They are one-to-one children with a required FK and no meaning apart
  // from their visit, so they are deleted BY APPOINTMENT rather than by their
  // own date - a vitals row recorded on the 12th for a visit on the 4th belongs
  // to that visit and goes with it. Guarding on them instead would also make
  // the dry run lie: `{ is: null }` is only true once the transaction has
  // already deleted them, so it would count zero deletable appointments.
};

const admissionDeletable = {
  ...beforeAdmission,
  invoices: { none: { createdAt: onOrAfter } },
  labTests: { none: { createdAt: onOrAfter } },
  prescriptionUploads: { none: { createdAt: onOrAfter } },
};

const patientDeletable = {
  ...before,
  invoices: { none: { createdAt: onOrAfter } },
  labTests: { none: { createdAt: onOrAfter } },
  appointments: { none: { createdAt: onOrAfter } },
  admissions: { none: { admittedAt: onOrAfter } },
  insuranceClaims: { none: { createdAt: onOrAfter } },
  prescriptionUploads: { none: { createdAt: onOrAfter } },
};

// ---- What is in scope -------------------------------------------------------
/**
 * Deliberately SEQUENTIAL, not Promise.all. Supabase's session-mode pooler
 * allows 15 clients and a parallel survey of this many tables exhausts it -
 * the script died on `max clients reached in session mode`. Nothing here is
 * hot enough to be worth a connection-limit query parameter and the race it
 * would invite when the purge itself is holding a transaction open.
 */
async function survey() {
  const invoices = await prisma.invoice.count({ where: before });
  const invoiceItems = await prisma.invoiceItem.count({ where: { invoice: beforeRel } });
  const payments = await prisma.payment.count({ where: { invoice: beforeRel } });
  const refunds = await prisma.refund.count({ where: { invoice: beforeRel } });
  const eInvoices = await prisma.eInvoice.count({ where: { invoice: beforeRel } });
  const eInvRegistered = await prisma.eInvoice.count({ where: { invoice: beforeRel, irn: { not: null } } });

  // Raw = created before the cutoff. Deletable = that, minus the ones a
  // surviving record still depends on. The gap is reported, not hidden.
  const labTestsRaw = await prisma.labTest.count({ where: before });
  const labTests = await prisma.labTest.count({ where: labTestDeletable });
  const labResults = await prisma.labResultItem.count({ where: { labTest: beforeRel } });

  const appointmentsRaw = await prisma.appointment.count({ where: before });
  const appointments = await prisma.appointment.count({ where: appointmentDeletable });
  const vitals = await prisma.vitals.count({ where: { appointment: beforeRel } });
  const apptRequests = await prisma.appointmentRequest.count({
    where: { OR: [before, { appointment: beforeRel }] },
  });

  const admissionsRaw = await prisma.admission.count({ where: beforeAdmission });
  const admissions = await prisma.admission.count({ where: admissionDeletable });
  const admissionsOpen = await prisma.admission.count({ where: { ...beforeAdmission, status: "ADMITTED" } });
  const charges = await prisma.admissionCharge.count({ where: { admission: beforeAdmissionRel } });
  const advances = await prisma.admissionAdvance.count({ where: { admission: beforeAdmissionRel } });
  const bedStays = await prisma.bedStay.count({ where: { admission: beforeAdmissionRel } });

  const patientsRaw = await prisma.patient.count({ where: before });
  const patients = await prisma.patient.count({ where: patientDeletable });
  const patientsStraddling = patientsRaw - patients;

  const staff = await prisma.user.count({ where: { ...before, role: { not: "ADMIN" } } });
  const claims = await prisma.insuranceClaim.count({ where: before });
  const claimsOpen = await prisma.insuranceClaim.count({
    where: { ...before, status: { notIn: ["SETTLED", "REJECTED", "CLOSED"] } },
  });

  const money = await prisma.invoice.aggregate({ where: before, _sum: { totalAmount: true } });
  const collected = await prisma.payment.aggregate({ where: { invoice: beforeRel }, _sum: { amount: true } });

  return {
    invoices, invoiceItems, payments, refunds, eInvoices, eInvRegistered,
    labTests, labTestsRaw, labResults,
    appointments, appointmentsRaw, vitals, apptRequests,
    admissions, admissionsRaw, admissionsOpen, charges, advances, bedStays,
    patients, patientsRaw, patientsStraddling, staff, claims, claimsOpen,
    billed: money._sum.totalAmount ?? 0, collected: collected._sum.amount ?? 0,
  };
}

function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => rl.question(question, resolve))
    .then((a) => { rl.close(); return a.trim() === "DELETE"; });
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  const host = url.replace(/\/\/[^@]*@/, "//***@").split("?")[0];

  const s = await survey();
  const active = [...scopes];

  console.log("\n  Target database : " + host);
  console.log("  Cutoff          : " + CUT.toString());
  console.log("  Deleting rows created STRICTLY BEFORE that instant.");
  console.log("  Scopes          : " + active.join(", "));
  console.log(EXECUTE ? "  Mode            : EXECUTE - this will delete\n" : "  Mode            : DRY RUN - nothing will be written\n");

  /** "12" or "12  (3 kept - a surviving record still needs them)". */
  const kept = (deletable: number, raw: number) =>
    raw > deletable ? `${deletable}   (${raw - deletable} kept - still needed by a record after the cutoff)` : `${deletable}`;

  console.log("  Will be deleted:");
  if (scopes.has("billing")) {
    console.log(`     invoices          ${s.invoices}   billed Rs ${s.billed}`);
    console.log(`     invoice items     ${s.invoiceItems}`);
    console.log(`     payments          ${s.payments}   collected Rs ${s.collected}`);
    console.log(`     refunds           ${s.refunds}`);
    console.log(`     insurance claims  ${s.claims}   (unsettled: ${s.claimsOpen})`);
    console.log(`     e-invoices        ${s.eInvoices}   (registered with govt: ${s.eInvRegistered})`);
  }
  if (scopes.has("labs")) {
    console.log(`     lab tests         ${kept(s.labTests, s.labTestsRaw)}`);
    console.log(`     lab result rows   ${s.labResults}`);
  }
  if (scopes.has("opd")) {
    console.log(`     appointments      ${kept(s.appointments, s.appointmentsRaw)}`);
    console.log(`     vitals            ${s.vitals}   callback requests ${s.apptRequests}`);
  }
  if (scopes.has("ipd")) {
    console.log(`     admissions        ${kept(s.admissions, s.admissionsRaw)}`);
    console.log(`     charges ${s.charges}   advances ${s.advances}   bed stays ${s.bedStays}`);
  }
  if (scopes.has("patients")) {
    console.log(`     patients          ${kept(s.patients, s.patientsRaw)}`);
  }
  if (scopes.has("staff")) {
    console.log(`     non-admin staff   ${s.staff}`);
  }

  // ---- Refusals -------------------------------------------------------------
  const stop: string[] = [];
  if (scopes.has("billing") && s.eInvRegistered > 0 && !GST_ACK) {
    stop.push(
      `${s.eInvRegistered} in-scope invoice(s) carry a government IRN. Deleting the local\n` +
      "    row does NOT cancel the e-invoice; it destroys the hospital's only proof\n" +
      "    that it was registered. Pass --i-understand-gst to proceed anyway.",
    );
  }
  if (scopes.has("ipd") && s.admissionsOpen > 0 && !FORCE) {
    stop.push(`${s.admissionsOpen} in-scope admission(s) are still ADMITTED - those patients are in a bed right now. Pass --force to proceed anyway.`);
  }
  if (scopes.has("billing") && s.claimsOpen > 0 && !FORCE) {
    stop.push(`${s.claimsOpen} in-scope insurance claim(s) are still unsettled - you would delete invoices an insurer is being asked to pay. Pass --force to proceed anyway.`);
  }
  if (scopes.has("billing") && s.patientsStraddling > 0) {
    console.log(`\n  ! ${s.patientsStraddling} patient(s) have records on BOTH sides of the cutoff.`);
    console.log("    The patient rows are KEPT (a surviving record needs them), but their");
    console.log("    pre-cutoff bills still go - so their billing history will have a hole.");
  }

  if (stop.length) {
    console.error("\n  REFUSING TO RUN:");
    for (const r of stop) console.error("  ✗ " + r);
    console.error("");
    process.exit(1);
  }

  if (!EXECUTE) {
    console.log("\n  Dry run: nothing was deleted. Add --execute to do it for real.");
    console.log("  Take a backup first: npm run backup\n");
    return;
  }

  if (!CONFIRMED) {
    console.log("\n  THIS CANNOT BE UNDONE. Backup first: npm run backup");
    if (!(await confirm("  Type DELETE to proceed (anything else aborts): "))) {
      console.log("\n  Aborted. Nothing was deleted.\n");
      return;
    }
  }

  console.log("\n  Deleting…");

  // One transaction: a partial purge that dies halfway would leave payments
  // pointing at invoices that no longer exist, and no way to tell how far it got.
  await prisma.$transaction(async (tx) => {
    // ---- 1. Billing -------------------------------------------------------
    if (scopes.has("billing")) {
      // Claims lead, because InsuranceClaim.patientId is a REQUIRED foreign key:
      // a claim left standing blocks its patient's deletion in step 5 with an
      // error that names the claim table and not the reason.
      await tx.claimEvent.deleteMany({ where: { claim: beforeRel } });
      await tx.insuranceClaim.deleteMany({ where: before });

      await tx.refund.deleteMany({ where: { invoice: beforeRel } });
      await tx.payment.deleteMany({ where: { invoice: beforeRel } });
      await tx.eInvoice.deleteMany({ where: { invoice: beforeRel } });
      await tx.invoiceItem.deleteMany({ where: { invoice: beforeRel } });
      await tx.invoice.deleteMany({ where: before });
      console.log("     ✓ invoices, items, payments, refunds, claims");
    }

    // ---- 2. Labs ----------------------------------------------------------
    if (scopes.has("labs")) {
      await tx.labResultItem.deleteMany({ where: { labTest: beforeRel } });
      // "This prescription advised this test" is a one-to-one link with no
      // cascade, so the test cannot go while the advice row still names it.
      // The row is UNLINKED rather than deleted: the advice itself may belong
      // to a prescription dated after the cutoff, which is being kept.
      await tx.prescriptionUploadLab.updateMany({
        where: { labTest: beforeRel },
        data: { labTestId: null },
      });
      await tx.labTest.deleteMany({ where: labTestDeletable });
      console.log("     ✓ lab tests and result rows (catalogue untouched)");
    }

    // ---- 3. IPD -----------------------------------------------------------
    if (scopes.has("ipd")) {
      await tx.admissionCharge.deleteMany({ where: { admission: beforeAdmissionRel } });
      await tx.admissionAdvance.deleteMany({ where: { admission: beforeAdmissionRel } });
      await tx.bedStay.deleteMany({ where: { admission: beforeAdmissionRel } });
      await tx.admissionNote.deleteMany({ where: { admission: beforeAdmissionRel } });
      await tx.dischargeSummary.deleteMany({ where: { admission: beforeAdmissionRel } });
      await tx.admission.deleteMany({ where: admissionDeletable });
      // Freeing the beds is not cosmetic: a bed still marked OCCUPIED by an
      // admission that no longer exists can never be allotted again, and no
      // screen in the portal can say why.
      //
      // THE `none` CLAUSE IS THE WHOLE SAFETY OF THIS STATEMENT. Freeing every
      // OCCUPIED bed unconditionally also frees the beds of patients who are
      // lying in them right now - post-cutoff admissions this purge is keeping -
      // and reception would then be free to allot an occupied bed to somebody
      // else. Only a bed that no ADMITTED admission still holds may be released.
      await tx.bed.updateMany({
        where: { status: "OCCUPIED", admissions: { none: { status: "ADMITTED" } } },
        data: { status: "AVAILABLE" },
      });
      console.log("     ✓ admissions, charges, advances, bed stays, notes");
    }

    // ---- 4. OPD -----------------------------------------------------------
    if (scopes.has("opd")) {
      await tx.vitals.deleteMany({ where: { appointment: beforeRel } });
      await tx.prescriptionItem.deleteMany({ where: { prescription: { is: { appointment: beforeRel } } } });
      await tx.prescription.deleteMany({ where: { appointment: beforeRel } });
      await tx.prescriptionUploadItem.deleteMany({ where: { upload: beforeRel } });
      await tx.prescriptionUploadLab.deleteMany({ where: { upload: beforeRel } });
      await tx.prescriptionUpload.deleteMany({ where: before });
      // Either the request itself is old, or it booked a visit that is going.
      await tx.appointmentRequest.deleteMany({
        where: { OR: [before, { appointment: beforeRel }] },
      });
      await tx.appointment.deleteMany({ where: appointmentDeletable });
      // A slot left flagged booked under a deleted appointment is a slot that
      // can never be sold again. isBlocked is the doctor's own leave, untouched.
      const freed = await tx.doctorSlot.updateMany({
        where: { isBooked: true, appointment: { is: null } },
        data: { isBooked: false },
      });
      console.log(`     ✓ appointments, vitals, prescriptions (${freed.count} slot(s) freed)`);
    }

    // ---- 5. Patients ------------------------------------------------------
    if (scopes.has("patients")) {
      // The audit log is KEPT and merely unlinked. Deleting a hospital's audit
      // trail to tidy up a patient list is the wrong trade; the entries stay,
      // pointing at nobody, which is what an anonymised log is.
      await tx.auditLog.updateMany({ where: { actorPatient: beforeRel }, data: { actorPatientId: null } });
      await tx.otp.deleteMany({ where: { patient: beforeRel } });
      await tx.refreshToken.deleteMany({ where: { patient: beforeRel } });
      // mergedIntoId is a Restrict self-relation: a merged patient points at its
      // survivor and the survivor cannot be deleted first. Break the links.
      await tx.patient.updateMany({ where: { mergedIntoId: { not: null } }, data: { mergedIntoId: null } });
      const gone = await tx.patient.deleteMany({ where: patientDeletable });
      console.log(`     ✓ ${gone.count} patient(s) and their sign-in artefacts`);
    }

    // ---- 6. Staff ---------------------------------------------------------
    if (scopes.has("staff")) {
      const removed = await tx.user.deleteMany({ where: { ...before, role: { not: "ADMIN" } } });
      console.log(`     ✓ ${removed.count} non-admin staff account(s)`);
    }
  }, { timeout: 120_000 });

  const after = await survey();
  console.log("\n  Done. Still before the cutoff:");
  console.log(`     invoices ${after.invoices}   lab tests ${after.labTests}   appointments ${after.appointments}   patients ${after.patients}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
