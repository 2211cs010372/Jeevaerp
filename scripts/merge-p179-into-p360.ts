import { prisma } from "../src/lib/prisma";

async function main() {
  const FROM_DISPLAY_ID = "JMH2026OP00179";
  const TO_DISPLAY_ID = "JMH2026OP00360";

  console.log(`Starting merge from ${FROM_DISPLAY_ID} into ${TO_DISPLAY_ID}...`);

  const fromPatient = await prisma.patient.findUniqueOrThrow({
    where: { displayId: FROM_DISPLAY_ID },
    include: {
      invoices: true,
      prescriptionUploads: true,
      appointments: true,
      labTests: true,
    },
  });

  const toPatient = await prisma.patient.findUniqueOrThrow({
    where: { displayId: TO_DISPLAY_ID },
    include: {
      admissions: {
        where: { ipNumber: "JMH2026IP00157" },
      },
    },
  });

  console.log(`From: ${fromPatient.fullName} (${fromPatient.id})`);
  console.log(`To:   ${toPatient.fullName} (${toPatient.id})`);

  const admission = toPatient.admissions[0];
  if (!admission) {
    throw new Error(`Admission JMH2026IP00157 not found on ${TO_DISPLAY_ID}!`);
  }
  console.log(`Target IP Admission: ${admission.ipNumber} (${admission.id}) - Status: ${admission.status}`);

  const pharmacyInvoices = fromPatient.invoices.filter((i) => i.source === "PHARMACY");
  const otherInvoices = fromPatient.invoices.filter((i) => i.source !== "PHARMACY");

  console.log(`Pharmacy invoices to link to IP stay: ${pharmacyInvoices.length} (${pharmacyInvoices.map(i => i.receiptNo).join(", ")})`);
  console.log(`Other invoices to transfer: ${otherInvoices.length} (${otherInvoices.map(i => i.receiptNo).join(", ")})`);
  console.log(`Prescription uploads: ${fromPatient.prescriptionUploads.length}`);
  console.log(`Appointments: ${fromPatient.appointments.length}`);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Update Pharmacy Invoices: change patientId to p360 and set admissionId to IP stay
    const updatedPharmacyInvoices = await tx.invoice.updateMany({
      where: {
        patientId: fromPatient.id,
        source: "PHARMACY",
      },
      data: {
        patientId: toPatient.id,
        admissionId: admission.id,
      },
    });

    // 2. Update Other Invoices (e.g. consultations): change patientId to p360 (keep admissionId null)
    const updatedOtherInvoices = await tx.invoice.updateMany({
      where: {
        patientId: fromPatient.id,
        source: { not: "PHARMACY" },
      },
      data: {
        patientId: toPatient.id,
      },
    });

    // 3. Update Prescription Uploads: change patientId to p360 and set admissionId
    const updatedUploads = await tx.prescriptionUpload.updateMany({
      where: { patientId: fromPatient.id },
      data: {
        patientId: toPatient.id,
        admissionId: admission.id,
      },
    });

    // 4. Update Appointments: change patientId to p360
    const updatedAppointments = await tx.appointment.updateMany({
      where: { patientId: fromPatient.id },
      data: {
        patientId: toPatient.id,
      },
    });

    // 5. Update target patient demographics if missing
    await tx.patient.update({
      where: { id: toPatient.id },
      data: {
        alternatePhone: toPatient.alternatePhone ?? fromPatient.phone,
        address: toPatient.address ?? fromPatient.address,
        dob: toPatient.dob ?? fromPatient.dob,
        referredByName: toPatient.referredByName ?? fromPatient.referredByName,
      },
    });

    // 6. Deactivate and mark source patient as merged
    const mergeRemark = `Merged into ${toPatient.displayId} (${toPatient.fullName}). Pharmacy bills (${pharmacyInvoices.length}) linked to IP stay ${admission.ipNumber}.`;
    const updatedFromPatient = await tx.patient.update({
      where: { id: fromPatient.id },
      data: {
        isActive: false,
        mergedIntoId: toPatient.id,
        remarks: fromPatient.remarks ? `${fromPatient.remarks} | ${mergeRemark}` : mergeRemark,
      },
    });

    // 7. Create Audit Log entry
    const audit = await tx.auditLog.create({
      data: {
        action: "PATIENT_MERGE",
        targetTable: "Patient",
        targetId: fromPatient.id,
        meta: {
          fromPatientId: fromPatient.id,
          fromDisplayId: fromPatient.displayId,
          toPatientId: toPatient.id,
          toDisplayId: toPatient.displayId,
          pharmacyInvoicesToStay: updatedPharmacyInvoices.count,
          otherInvoicesTransferred: updatedOtherInvoices.count,
          prescriptionUploadsTransferred: updatedUploads.count,
          appointmentsTransferred: updatedAppointments.count,
          linkedAdmissionId: admission.id,
          linkedAdmissionIpNumber: admission.ipNumber,
          pharmacyReceipts: pharmacyInvoices.map((i) => i.receiptNo),
          otherReceipts: otherInvoices.map((i) => i.receiptNo),
        },
      },
    });

    return {
      pharmacyInvoicesMovedToStay: updatedPharmacyInvoices.count,
      otherInvoicesMoved: updatedOtherInvoices.count,
      prescriptionsMoved: updatedUploads.count,
      appointmentsMoved: updatedAppointments.count,
      auditId: audit.id,
    };
  });

  console.log("\nMerge executed successfully!");
  console.log("Result:", result);

  // Verification step
  const verifyFrom = await prisma.patient.findUnique({
    where: { id: fromPatient.id },
    include: { invoices: true, prescriptionUploads: true, appointments: true },
  });

  const verifyTo = await prisma.patient.findUnique({
    where: { id: toPatient.id },
    include: {
      invoices: {
        orderBy: { createdAt: "asc" },
        select: { receiptNo: true, source: true, totalAmount: true, admissionId: true },
      },
      prescriptionUploads: {
        select: { id: true, admissionId: true },
      },
      appointments: {
        select: { id: true },
      },
    },
  });

  console.log("\n=== VERIFICATION ===");
  console.log(`From Patient (${verifyFrom?.displayId}):`);
  console.log(` - isActive: ${verifyFrom?.isActive}`);
  console.log(` - mergedIntoId: ${verifyFrom?.mergedIntoId}`);
  console.log(` - remaining invoices: ${verifyFrom?.invoices.length}`);
  console.log(` - remaining uploads: ${verifyFrom?.prescriptionUploads.length}`);
  console.log(` - remaining appointments: ${verifyFrom?.appointments.length}`);

  console.log(`\nTo Patient (${verifyTo?.displayId}):`);
  console.log(` - total invoices: ${verifyTo?.invoices.length}`);
  const ipStayBills = verifyTo?.invoices.filter((i) => i.admissionId === admission.id);
  console.log(` - bills attached to IP stay (${admission.ipNumber}): ${ipStayBills?.length}`);
  for (const b of ipStayBills || []) {
    console.log(`    ${b.receiptNo} [${b.source}] ₹${b.totalAmount}`);
  }
}

main()
  .catch((e) => {
    console.error("Merge failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
