import { prisma } from "../src/lib/prisma";

async function main() {
  const FROM_DISPLAY_ID = "JMH2026OP00289";
  const TO_DISPLAY_ID = "JMH2026OP00252";

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
        where: { ipNumber: "JMH2026IP00032" },
      },
    },
  });

  console.log(`From: ${fromPatient.fullName} (${fromPatient.id})`);
  console.log(`To:   ${toPatient.fullName} (${toPatient.id})`);

  if (fromPatient.appointments.length > 0) {
    console.warn(`Warning: From patient has ${fromPatient.appointments.length} appointments.`);
  }
  if (fromPatient.labTests.length > 0) {
    console.warn(`Warning: From patient has ${fromPatient.labTests.length} lab tests.`);
  }

  const admission = toPatient.admissions[0];
  console.log(`Linking invoices & prescriptions to admission: ${admission ? admission.ipNumber : "None"}`);

  const invoiceCount = fromPatient.invoices.length;
  const prescriptionCount = fromPatient.prescriptionUploads.length;

  console.log(`Found ${invoiceCount} invoices and ${prescriptionCount} prescription uploads to merge.`);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Update Invoices
    const updatedInvoices = await tx.invoice.updateMany({
      where: { patientId: fromPatient.id },
      data: {
        patientId: toPatient.id,
        ...(admission ? { admissionId: admission.id } : {}),
      },
    });

    // 2. Update Prescription Uploads
    const updatedUploads = await tx.prescriptionUpload.updateMany({
      where: { patientId: fromPatient.id },
      data: {
        patientId: toPatient.id,
        ...(admission ? { admissionId: admission.id } : {}),
      },
    });

    // 3. Update target patient demographics if missing
    await tx.patient.update({
      where: { id: toPatient.id },
      data: {
        alternatePhone: toPatient.alternatePhone ?? fromPatient.phone,
        address: toPatient.address ?? fromPatient.address,
      },
    });

    // 4. Deactivate and mark source patient as merged
    const mergeRemark = `Merged into ${toPatient.displayId} (${toPatient.fullName}). All ${invoiceCount} pharmacy bills and ${prescriptionCount} prescription uploads transferred.`;
    const updatedFromPatient = await tx.patient.update({
      where: { id: fromPatient.id },
      data: {
        isActive: false,
        mergedIntoId: toPatient.id,
        remarks: fromPatient.remarks ? `${fromPatient.remarks} | ${mergeRemark}` : mergeRemark,
      },
    });

    // 5. Create Audit Log entry
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
          invoicesTransferred: updatedInvoices.count,
          prescriptionUploadsTransferred: updatedUploads.count,
          linkedAdmissionId: admission?.id ?? null,
          invoiceReceipts: fromPatient.invoices.map((i) => i.receiptNo),
        },
      },
    });

    return {
      invoicesUpdated: updatedInvoices.count,
      prescriptionsUpdated: updatedUploads.count,
      auditId: audit.id,
    };
  });

  console.log("Merge completed successfully!");
  console.log("Result:", result);

  // Verification step
  const verifyFrom = await prisma.patient.findUnique({
    where: { id: fromPatient.id },
    include: { invoices: true, prescriptionUploads: true },
  });

  const verifyTo = await prisma.patient.findUnique({
    where: { id: toPatient.id },
    include: {
      invoices: {
        where: { source: "PHARMACY" },
        select: { receiptNo: true, admissionId: true, totalAmount: true },
      },
    },
  });

  console.log("\n=== VERIFICATION ===");
  console.log(`From Patient (${verifyFrom?.displayId}):`);
  console.log(` - isActive: ${verifyFrom?.isActive}`);
  console.log(` - mergedIntoId: ${verifyFrom?.mergedIntoId}`);
  console.log(` - remaining invoices: ${verifyFrom?.invoices.length}`);
  console.log(` - remaining uploads: ${verifyFrom?.prescriptionUploads.length}`);

  console.log(`To Patient (${verifyTo?.displayId}):`);
  console.log(` - total pharmacy bills: ${verifyTo?.invoices.length}`);
}

main()
  .catch((e) => {
    console.error("Merge failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
