import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { storeFile } from "@/lib/storage";
import { logAudit } from "./audit.service";
import { DUTY_DOCTOR } from "./appointments.service";
import { createInvoice, type BillLineInput } from "./billing.service";
import { collectionByMode, type ModeTotal } from "./reports.service";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

export interface CatalogItemDTO {
  id: string; name: string; code: string | null; price: string; gstRatePct: string; active: boolean;
}
export interface LabTestDTO {
  id: string; testName: string; status: string; price: string | null;
  reportFileUrl: string | null; createdAt: string; completedAt: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  billed: boolean;
}

/** Active test catalog (what the lab can order/bill). */
export async function listCatalog(): Promise<CatalogItemDTO[]> {
  const rows = await prisma.labTestCatalog.findMany({
    where: { active: true }, orderBy: { name: "asc" },
    select: { id: true, name: true, code: true, price: true, gstRatePct: true, active: true },
  });
  return rows.map((c: { id: string; name: string; code: string | null; price: { toString(): string }; gstRatePct: { toString(): string }; active: boolean }) => ({
    id: c.id, name: c.name, code: c.code, price: c.price.toString(), gstRatePct: c.gstRatePct.toString(), active: c.active,
  }));
}

const testSelect = {
  id: true, testName: true, status: true, priceAtOrder: true,
  reportFileUrl: true, createdAt: true, completedAt: true,
  patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
  appointment: {
    select: {
      opNumber: true, visitDate: true,
      doctor: { select: { name: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
    },
  },
  invoiceItems: { select: { id: true } },
} as const;

type TestRow = {
  id: string; testName: string; status: string; priceAtOrder: { toString(): string } | null;
  reportFileUrl: string | null; createdAt: Date; completedAt: Date | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: {
    opNumber: string; visitDate: Date; doctor: { name: string } | null;
    patient: { id: string; displayId: string; fullName: string; phone: string };
  } | null;
  invoiceItems: { id: string }[];
};

function toTestDTO(t: TestRow): LabTestDTO {
  // A test links to a patient directly (walk-in) or via its appointment.
  const p = t.patient ?? t.appointment?.patient ?? null;
  return {
    id: t.id, testName: t.testName, status: t.status,
    price: t.priceAtOrder ? t.priceAtOrder.toString() : null,
    reportFileUrl: t.reportFileUrl,
    createdAt: t.createdAt.toISOString(),
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    patient: p,
    appointment: t.appointment
      ? { opNumber: t.appointment.opNumber, doctorName: t.appointment.doctor?.name ?? DUTY_DOCTOR.name, visitDate: t.appointment.visitDate.toISOString().slice(0, 10) }
      : null,
    billed: t.invoiceItems.length > 0,
  };
}

/** The lab work queue - pending first, newest first. */
export async function listLabTests(status?: "PENDING" | "COMPLETED"): Promise<LabTestDTO[]> {
  const rows: TestRow[] = await prisma.labTest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: testSelect,
  });
  return rows.map(toTestDTO);
}

/** Order one or more tests for a patient (walk-in - no doctor visit needed). */
/**
 * Order tests for a patient.
 *
 * If the patient is ADMITTED, the tests belong to the stay, not to a visit -
 * they file against the admission and raise their OWN unpaid LAB bill, exactly
 * like pharmacy. Nobody chases an inpatient's family to the collection window;
 * the bill is marked due and settled on the way out.
 *
 * Labs, pharmacy and the stay are three separate bills. They are deliberately
 * NOT merged into the discharge invoice: each desk keeps its own document, its
 * own GST position and its own record of what it is owed.
 *
 * The caller doesn't have to know. We look it up.
 */
export async function orderTests(
  actor: AuthUser,
  input: { patientId: string; catalogIds: string[]; appointmentId?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<LabTestDTO[] & { chargedToRoom?: boolean }> {
  if (!input.catalogIds.length) throw new ApiError(400, "Select at least one test");

  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, mergedIntoId: true, deletedAt: true },
  });
  if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "Patient not found");

  const catalog = await prisma.labTestCatalog.findMany({
    where: { id: { in: input.catalogIds }, active: true },
    select: { id: true, name: true, price: true },
  });
  if (catalog.length !== input.catalogIds.length) throw new ApiError(400, "One or more tests are unavailable");

  // Is this patient in a bed? That single fact decides where the money goes.
  const admission = await prisma.admission.findFirst({
    where: { patientId: input.patientId, status: "ADMITTED" },
    orderBy: { admittedAt: "desc" },
    select: { id: true, ipNumber: true },
  });

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ids: string[] = [];
    for (const c of catalog) {
      const t = await tx.labTest.create({
        data: {
          patientId: input.patientId,
          // an inpatient's test hangs off the STAY; an outpatient's off the visit
          appointmentId: admission ? null : (input.appointmentId ?? null),
          admissionId: admission?.id ?? null,
          catalogId: c.id,
          testName: c.name,
          priceAtOrder: c.price, // snapshot - survives catalog price changes
          status: "PENDING",
        },
        select: { id: true },
      });
      ids.push(t.id);

      // An inpatient's investigations get their own LAB bill, raised after this
      // transaction closes - see below. They are NOT posted to the room tab any
      // more: labs, pharmacy and the stay are three separate bills, each
      // settled on its own.
    }
    await logAudit(actor, {
      action: admission ? "LAB_TESTS_ORDERED_IP" : "LAB_TESTS_ORDERED",
      targetTable: "LabTest", targetId: ids[0],
      meta: { count: ids.length, patientId: input.patientId, ipNumber: admission?.ipNumber ?? null },
      ...ctx,
    }, tx);
    return ids;
  });

  const rows: TestRow[] = await prisma.labTest.findMany({ where: { id: { in: created } }, select: testSelect });

  // AN INPATIENT'S TESTS GET THEIR OWN LAB BILL, left UNPAID.
  //
  // Raised outside the transaction above because createInvoice runs its own,
  // and nesting them would hold a write lock across the whole thing.
  //
  // Unpaid on purpose: the family settles on the way out, not at the collection
  // window. Linked to the admission so the discharge desk can see it
  // outstanding and nobody leaves owing the lab money.
  if (admission) {
    await createInvoice(
      actor,
      {
        patientId: input.patientId,
        source: "LAB",
        admissionId: admission.id,
        // Diagnostics are GST-exempt in this hospital's tax position.
        lines: catalog.map((c) => ({
          description: c.name,
          qty: 1,
          unitPrice: Number(c.price.toString()),
          gstRatePct: 0,
        })),
        notes: `Inpatient ${admission.ipNumber} - due at discharge`,
      },
      ctx
    );
  }

  const dtos = rows.map(toTestDTO) as LabTestDTO[] & { chargedToRoom?: boolean };
  // The UI must be able to say "do not take money now" - the bill is due at
  // discharge, not at the window.
  dtos.chargedToRoom = !!admission;
  return dtos;
}

/** Upload a report file and mark the test completed. */
export async function uploadReport(
  actor: AuthUser,
  input: { labTestId: string; file: { buffer: Buffer; fileName: string; mimeType: string; size: number } },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<LabTestDTO> {
  const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(input.file.mimeType)) throw new ApiError(400, "Only PDF, JPG, PNG or WebP reports are allowed");
  if (input.file.size > 10 * 1024 * 1024) throw new ApiError(400, "File too large (max 10 MB)");

  const test = await prisma.labTest.findUnique({ where: { id: input.labTestId }, select: { id: true } });
  if (!test) throw new ApiError(404, "Test not found");

  const stored = await storeFile(input.file.buffer, { fileName: input.file.fileName, mimeType: input.file.mimeType, folder: "jeeva/lab-reports" });

  await prisma.labTest.update({
    where: { id: input.labTestId },
    data: {
      reportFileUrl: stored.fileUrl,
      reportUploadedAt: new Date(),
      status: "COMPLETED",
      completedAt: new Date(),
      technicianId: actor.id,
    },
  });
  await logAudit(actor, { action: "LAB_REPORT_UPLOADED", targetTable: "LabTest", targetId: input.labTestId, ...ctx });

  const row: TestRow | null = await prisma.labTest.findUnique({ where: { id: input.labTestId }, select: testSelect });
  if (!row) throw new ApiError(404, "Test not found");
  return toTestDTO(row);
}

/** Mark a test completed without a file (result given on paper). */
export async function completeTest(actor: AuthUser, labTestId: string, ctx: { ipAddress?: string; userAgent?: string }): Promise<LabTestDTO> {
  const test = await prisma.labTest.findUnique({ where: { id: labTestId }, select: { id: true, status: true } });
  if (!test) throw new ApiError(404, "Test not found");
  if (test.status === "COMPLETED") throw new ApiError(400, "This test is already completed");

  await prisma.labTest.update({
    where: { id: labTestId },
    data: { status: "COMPLETED", completedAt: new Date(), technicianId: actor.id },
  });
  await logAudit(actor, { action: "LAB_TEST_COMPLETED", targetTable: "LabTest", targetId: labTestId, ...ctx });

  const row: TestRow | null = await prisma.labTest.findUnique({ where: { id: labTestId }, select: testSelect });
  if (!row) throw new ApiError(404, "Test not found");
  return toTestDTO(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURED RESULTS
//
// A PDF is a picture of a result; it can't be flagged, trended or read by the
// doctor's screen. These are the actual numbers, each carried next to the
// reference range it was judged against.
// ─────────────────────────────────────────────────────────────────────────────

export type LabResultFlagT = "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";

export interface LabResultDTO {
  name: string; unit: string | null; value: string;
  refLow: string | null; refHigh: string | null; refText: string | null;
  flag: LabResultFlagT; sortOrder: number;
}

export interface LabResultInput {
  name: string; unit?: string | null; value: string;
  refLow?: number | null; refHigh?: number | null; refText?: string | null;
  /** For results that aren't numbers ("Positive"), the lab says if it's abnormal. */
  abnormal?: boolean;
}

/** A value is only numeric if the whole string is a number - "<0.5" is text. */
function toNumeric(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Where a value sits against its range. Numbers are judged against the range;
 * anything non-numeric is whatever the lab marked it, because only they can say
 * whether "Growth seen" is abnormal.
 */
export function flagFor(
  valueNum: number | null,
  refLow: number | null,
  refHigh: number | null,
  abnormal = false
): LabResultFlagT {
  if (valueNum === null) return abnormal ? "ABNORMAL" : "NORMAL";
  if (refHigh !== null && valueNum > refHigh) return "HIGH";
  if (refLow !== null && valueNum < refLow) return "LOW";
  return "NORMAL";
}

const dec = (v: { toString(): string } | null | undefined) => (v == null ? null : v.toString());

/**
 * The result sheet a technician works on: the saved values if there are any,
 * otherwise blank rows pre-filled from the test's analyte template so nobody
 * retypes "Haemoglobin  g/dL  13-17" for every patient.
 */
export async function labResultSheet(labTestId: string): Promise<{
  test: {
    id: string; testName: string; status: string; completedAt: string | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null } | null;
  };
  results: LabResultDTO[];
  fromTemplate: boolean;
}> {
  const t = await prisma.labTest.findUnique({
    where: { id: labTestId },
    select: {
      id: true, testName: true, status: true, completedAt: true, catalogId: true,
      patient: { select: { displayId: true, fullName: true, age: true, gender: true } },
      results: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!t) throw new ApiError(404, "Test not found");

  type Row = { name: string; unit: string | null; value: string; refLow: unknown; refHigh: unknown; refText: string | null; flag: string; sortOrder: number };
  const saved = (t.results as Row[]).map((r) => ({
    name: r.name, unit: r.unit, value: r.value,
    refLow: dec(r.refLow as { toString(): string } | null), refHigh: dec(r.refHigh as { toString(): string } | null),
    refText: r.refText, flag: r.flag as LabResultFlagT, sortOrder: r.sortOrder,
  }));

  let results = saved;
  let fromTemplate = false;
  if (saved.length === 0 && t.catalogId) {
    const tpl = await prisma.labAnalyte.findMany({ where: { catalogId: t.catalogId }, orderBy: { sortOrder: "asc" } });
    type Tpl = { name: string; unit: string | null; refLow: unknown; refHigh: unknown; refText: string | null; sortOrder: number };
    results = (tpl as Tpl[]).map((a) => ({
      name: a.name, unit: a.unit, value: "",
      refLow: dec(a.refLow as { toString(): string } | null), refHigh: dec(a.refHigh as { toString(): string } | null),
      refText: a.refText, flag: "NORMAL" as LabResultFlagT, sortOrder: a.sortOrder,
    }));
    fromTemplate = results.length > 0;
  }

  return {
    test: {
      id: t.id, testName: t.testName, status: t.status,
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      patient: t.patient,
    },
    results,
    fromTemplate,
  };
}

/**
 * Save the measured values. Replaces the whole sheet - editing a result is
 * re-entering the sheet, and a half-updated report is worse than none. The
 * range is snapshot onto each line so a later catalog edit can't silently
 * re-grade a report the patient already has.
 */
export async function saveLabResults(
  actor: AuthUser,
  input: { labTestId: string; items: LabResultInput[]; complete?: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ results: LabResultDTO[]; abnormal: number }> {
  const test = await prisma.labTest.findUnique({
    where: { id: input.labTestId },
    select: { id: true, testName: true, patientId: true },
  });
  if (!test) throw new ApiError(404, "Test not found");

  const rows = input.items
    .map((it, i) => ({ ...it, name: it.name.trim(), value: it.value.trim(), sortOrder: i }))
    .filter((it) => it.name.length > 0 && it.value.length > 0);
  if (rows.length === 0) throw new ApiError(400, "Enter a value for at least one analyte");

  const prepared = rows.map((it) => {
    const valueNum = toNumeric(it.value);
    const refLow = it.refLow ?? null;
    const refHigh = it.refHigh ?? null;
    return {
      labTestId: input.labTestId,
      name: it.name,
      unit: it.unit?.trim() || null,
      value: it.value,
      valueNum: valueNum === null ? null : valueNum.toFixed(4),
      refLow: refLow === null ? null : refLow.toFixed(4),
      refHigh: refHigh === null ? null : refHigh.toFixed(4),
      refText: it.refText?.trim() || null,
      flag: flagFor(valueNum, refLow, refHigh, it.abnormal) as never,
      sortOrder: it.sortOrder,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.labResultItem.deleteMany({ where: { labTestId: input.labTestId } });
    await tx.labResultItem.createMany({ data: prepared });
    if (input.complete !== false) {
      await tx.labTest.update({
        where: { id: input.labTestId },
        data: { status: "COMPLETED", completedAt: new Date(), technicianId: actor.id },
      });
    }
  });

  const abnormal = prepared.filter((p) => (p.flag as unknown as string) !== "NORMAL").length;
  await logAudit(actor, {
    action: "LAB_RESULTS_SAVED", targetTable: "LabTest", targetId: input.labTestId,
    meta: { testName: test.testName, lines: prepared.length, abnormal },
    ...ctx,
  });

  const sheet = await labResultSheet(input.labTestId);
  return { results: sheet.results, abnormal };
}

/**
 * Generate a GST bill for one or more lab tests. GST rate comes from each
 * test's catalog entry (0% = exempt, the correct default for diagnostics -
 * the hospital's CA can set real rates per test in the catalog).
 */
export async function billLabTests(
  actor: AuthUser,
  input: {
    patientId: string;
    labTestIds: string[];
    discountAmount?: number;
    payment?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string };
    payments?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string }[];
  },
  ctx: { ipAddress?: string; userAgent?: string }
) {
  if (!input.labTestIds.length) throw new ApiError(400, "Select at least one test to bill");

  const tests = await prisma.labTest.findMany({
    where: { id: { in: input.labTestIds } },
    select: {
      id: true, testName: true, priceAtOrder: true, patientId: true,
      appointmentId: true,
      catalog: { select: { gstRatePct: true, code: true } },
      invoiceItems: { select: { id: true } },
      appointment: { select: { patientId: true } },
    },
  });
  if (tests.length !== input.labTestIds.length) throw new ApiError(400, "One or more tests not found");

  const lines: BillLineInput[] = [];
  for (const t of tests) {
    if (t.invoiceItems.length > 0) throw new ApiError(400, `"${t.testName}" is already billed`);
    const owner = t.patientId ?? t.appointment?.patientId;
    if (owner !== input.patientId) throw new ApiError(400, "A test doesn't belong to this patient");
    lines.push({
      description: t.testName,
      qty: 1,
      unitPrice: Number(t.priceAtOrder?.toString() ?? 0),
      gstRatePct: Number(t.catalog?.gstRatePct?.toString() ?? 0),
      hsnSac: t.catalog?.code ?? undefined,
      labTestId: t.id,
    });
  }

  const appointmentId = tests.find((t: { appointmentId: string | null }) => t.appointmentId)?.appointmentId ?? undefined;

  return createInvoice(
    actor,
    { patientId: input.patientId, source: "LAB", appointmentId, lines, discountAmount: input.discountAmount, payment: input.payment, payments: input.payments },
    ctx
  );
}

/** Lab dashboard counters. */
export async function labStats(): Promise<{
  pending: number; completedToday: number; totalToday: number; revenueToday: string; unbilled: number;
  /** Finished tests whose report file was never uploaded - the loose ends. */
  reportsPending: number;
  /** Tests riding on an inpatient's room tab rather than a counter bill. */
  ipdTests: number;
  collections: ModeTotal[];
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

  const [pending, completedToday, totalToday, invoices, unbilled, reportsPending, ipdTests] = await Promise.all([
    prisma.labTest.count({ where: { status: "PENDING" } }),
    prisma.labTest.count({ where: { status: "COMPLETED", completedAt: { gte: today, lt: tomorrow } } }),
    prisma.labTest.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    prisma.invoice.findMany({
      where: { source: "LAB", createdAt: { gte: today, lt: tomorrow }, status: { not: "CANCELLED" } },
      select: { totalAmount: true },
    }),
    prisma.labTest.count({ where: { invoiceItems: { none: {} }, admissionId: null } }),
    prisma.labTest.count({ where: { status: "COMPLETED", reportFileUrl: null } }),
    prisma.labTest.count({ where: { admissionId: { not: null }, status: "PENDING" } }),
  ]);

  const revenue = invoices.reduce((s: number, i: { totalAmount: { toString(): string } }) => s + Number(i.totalAmount.toString()), 0);
  // What the lab till took today, split by payment type.
  const collections = await collectionByMode({ sources: ["LAB"] });
  return { pending, completedToday, totalToday, revenueToday: revenue.toFixed(2), unbilled, reportsPending, ipdTests, collections: collections.modes };
}

/** A patient's lab history + last visit - what the lab needs at the counter. */
export async function patientLabHistory(displayId: string): Promise<{
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null; gender: string | null; bloodGroup: string | null };
  lastVisit: { opNumber: string; visitDate: string; doctorName: string; department: string; status: string } | null;
  tests: LabTestDTO[];
  invoices: { receiptNo: string; totalAmount: string; status: string; createdAt: string }[];
}> {
  const patient = await prisma.patient.findUnique({
    where: { displayId },
    select: {
      id: true, displayId: true, fullName: true, phone: true, age: true,
      gender: true, bloodGroup: true, mergedIntoId: true, deletedAt: true,
    },
  });
  if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "No patient found with that ID");

  const [lastAppt, tests, invoices] = await Promise.all([
    prisma.appointment.findFirst({
      where: { patientId: patient.id },
      orderBy: { visitDate: "desc" },
      select: { opNumber: true, visitDate: true, status: true, doctor: { select: { name: true, department: true } } },
    }),
    prisma.labTest.findMany({
      where: { OR: [{ patientId: patient.id }, { appointment: { patientId: patient.id } }] },
      orderBy: { createdAt: "desc" }, take: 50, select: testSelect,
    }),
    prisma.invoice.findMany({
      where: { patientId: patient.id, source: "LAB" },
      orderBy: { createdAt: "desc" }, take: 20,
      select: { receiptNo: true, totalAmount: true, status: true, createdAt: true },
    }),
  ]);

  return {
    patient: {
      id: patient.id, displayId: patient.displayId, fullName: patient.fullName, phone: patient.phone,
      age: patient.age, gender: patient.gender, bloodGroup: patient.bloodGroup,
    },
    lastVisit: lastAppt
      ? {
          opNumber: lastAppt.opNumber,
          visitDate: lastAppt.visitDate.toISOString().slice(0, 10),
          doctorName: lastAppt.doctor?.name ?? DUTY_DOCTOR.name,
          department: lastAppt.doctor?.department ?? DUTY_DOCTOR.department,
          status: lastAppt.status,
        }
      : null,
    tests: (tests as TestRow[]).map(toTestDTO),
    invoices: invoices.map((i: { receiptNo: string; totalAmount: { toString(): string }; status: string; createdAt: Date }) => ({
      receiptNo: i.receiptNo, totalAmount: i.totalAmount.toString(), status: i.status, createdAt: i.createdAt.toISOString(),
    })),
  };
}

/** Remove a lab report file and reopen the test (back to PENDING). */
export async function removeReport(
  actor: AuthUser,
  labTestId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<LabTestDTO> {
  const test = await prisma.labTest.findUnique({ where: { id: labTestId }, select: { id: true, reportFileUrl: true } });
  if (!test) throw new ApiError(404, "Test not found");
  if (!test.reportFileUrl) throw new ApiError(400, "This test has no report to remove");

  await prisma.labTest.update({
    where: { id: labTestId },
    data: { reportFileUrl: null, reportUploadedAt: null, status: "PENDING", completedAt: null },
  });
  await logAudit(actor, { action: "LAB_REPORT_REMOVED", targetTable: "LabTest", targetId: labTestId, ...ctx });

  const row: TestRow | null = await prisma.labTest.findUnique({ where: { id: labTestId }, select: testSelect });
  if (!row) throw new ApiError(404, "Test not found");
  return toTestDTO(row);
}
