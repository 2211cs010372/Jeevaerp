import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { storeFile } from "@/lib/storage";
import { logAudit } from "./audit.service";
import { DUTY_DOCTOR } from "./appointments.service";
import { createInvoice, type BillLineInput, type InvoiceDTO } from "./billing.service";
import { registerPatient } from "./reception.service";
import { notifyLabReportReady } from "./notify.service";
import { collectionByMode, type ModeTotal } from "./reports.service";
import { publishLive } from "@/server/realtime/publish";
import { parseLocalDate } from "@/lib/date";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import { linkAdvisedLabs } from "./prescriptions.service";
import { isInHouseReferrer } from "@/lib/labs/referrer";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

export interface CatalogItemDTO {
  id: string; name: string; code: string | null; price: string; gstRatePct: string; active: boolean;
}
export interface LabTestDTO {
  id: string; testName: string; status: string; price: string | null;
  /**
   * The order this test was raised in (see LabTest.orderGroupId). Null on tests
   * that predate orders - the queue reads those as an order of one.
   */
  orderGroupId: string | null;
  reportFileUrl: string | null; createdAt: string; completedAt: string | null;
  /**
   * The date the desk corrected this order to (see LabTest.orderedAt). Null on
   * everything nobody has had to correct - read it as `orderedAt ?? createdAt`,
   * which is what the report prints as "Registered On".
   */
  orderedAt: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  /**
   * The doctor named on the order when no visit here named one - a chit from
   * outside. Null when the test came off a consultation, whose own doctor is
   * already on `appointment`.
   */
  referringDoctor: { id: string; name: string } | null;
  /** A referrer that isn't a doctor on the roster - the hospital itself, most
   *  often. Set only when `referringDoctor` is null. See lib/labs/referrer. */
  referringName: string | null;
  billed: boolean;
  /**
   * The measured analyte values, when the bench entered them. Optional because
   * the work queue and the billing screens have no use for them and shouldn't
   * pay to load them - only the screens that READ a result fill this in.
   */
  results?: LabResultDTO[];
  /** Lines out of range on this test. Only meaningful alongside `results`. */
  abnormal?: number;
  /**
   * The bench's read of its own numbers (see LabTest.impression). Carried on
   * the queue row itself, not behind a second fetch: the whole point of writing
   * it is that whoever opens the list sees it without asking.
   */
  impression: string | null;
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
  id: true, testName: true, status: true, priceAtOrder: true, orderGroupId: true,
  reportFileUrl: true, createdAt: true, orderedAt: true, completedAt: true, impression: true,
  patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
  appointment: {
    select: {
      opNumber: true, visitDate: true,
      doctor: { select: { name: true } },
      patient: { select: { id: true, displayId: true, fullName: true, phone: true } },
    },
  },
  referringDoctor: { select: { id: true, name: true } },
  referringName: true,
  invoiceItems: { select: { id: true } },
} as const;

type TestRow = {
  id: string; testName: string; status: string; priceAtOrder: { toString(): string } | null;
  orderGroupId: string | null;
  reportFileUrl: string | null; createdAt: Date; orderedAt: Date | null;
  completedAt: Date | null; impression: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: {
    opNumber: string; visitDate: Date; doctor: { name: string } | null;
    patient: { id: string; displayId: string; fullName: string; phone: string };
  } | null;
  referringDoctor: { id: string; name: string } | null;
  referringName: string | null;
  invoiceItems: { id: string }[];
};

function toTestDTO(t: TestRow): LabTestDTO {
  // A test links to a patient directly (walk-in) or via its appointment.
  const p = t.patient ?? t.appointment?.patient ?? null;
  return {
    id: t.id, testName: t.testName, status: t.status,
    price: t.priceAtOrder ? t.priceAtOrder.toString() : null,
    orderGroupId: t.orderGroupId,
    reportFileUrl: t.reportFileUrl,
    createdAt: t.createdAt.toISOString(),
    orderedAt: t.orderedAt ? t.orderedAt.toISOString() : null,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    patient: p,
    appointment: t.appointment
      ? { opNumber: t.appointment.opNumber, doctorName: t.appointment.doctor?.name ?? DUTY_DOCTOR.name, visitDate: t.appointment.visitDate.toISOString().slice(0, 10) }
      : null,
    referringDoctor: t.referringDoctor,
    referringName: t.referringName,
    billed: t.invoiceItems.length > 0,
    impression: t.impression,
  };
}

/**
 * Individual tests - pending first, newest first.
 *
 * The bench reads `listLabOrders` instead; this stays flat for the screens that
 * genuinely count tests rather than jobs (the lab dashboard's tallies).
 */
export async function listLabTests(status?: "PENDING" | "COMPLETED"): Promise<LabTestDTO[]> {
  const rows: TestRow[] = await prisma.labTest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: testSelect,
  });
  return rows.map(toTestDTO);
}

/**
 * ONE ORDER = ONE ROW.
 *
 * What the technician picked in a single submit is one job at the bench: one
 * patient, one sample, one line in the queue - however many tests it covers.
 * The flat list this replaces drew a CBP, an LFT and a TSH for the same tube as
 * three unrelated rows, three deep, with the patient's name repeated on each.
 *
 * The tests themselves stay separate inside the order, because they finish
 * separately: an LFT off the analyser at 11:00 must be releasable while the
 * culture in the same order is still growing.
 */
export interface LabOrderDTO {
  /** The order's identity - its orderGroupId, or a lone test's own id. */
  id: string;
  createdAt: string;
  /** The desk's correction to the registration date, if it made one. */
  orderedAt: string | null;
  patient: { id: string; displayId: string; fullName: string; phone: string } | null;
  appointment: { opNumber: string; doctorName: string; visitDate: string } | null;
  /** Named on the order when no visit here named a doctor - a chit from outside. */
  referringDoctor: { id: string; name: string } | null;
  /** A referrer that isn't on the roster - the hospital itself, most often. */
  referringName: string | null;
  /** Every test on the order, in the sequence it was raised in. */
  tests: LabTestDTO[];
  /** PENDING while ANY test is still on the bench - the order isn't done until all of it is. */
  status: "PENDING" | "COMPLETED";
  pending: number;
  /** Snapshotted prices, summed. Null when no test on the order carries one. */
  total: string | null;
  /** Every test on the order is on a bill. A part-billed order reads as unbilled. */
  billed: boolean;
}

/**
 * The lab work queue, by order - pending first, newest first.
 *
 * `status` filters which ORDERS are shown, never which of their tests: an order
 * with one test left pending is a pending order, and it is drawn with all of
 * its tests, the finished ones included. Hiding the released tests would leave
 * the bench looking at a row that says "1 test" for a sample they know carried
 * four, and re-releasing what was already handed over is the predictable next
 * step. It also means a part-finished order stays under Pending and is not yet
 * under Completed - it appears in exactly one place, and that place is the one
 * with work left in it.
 */
export async function listLabOrders(status?: "PENDING" | "COMPLETED"): Promise<LabOrderDTO[]> {
  // Which orders, cheaply. Ids only - the wide row select runs once the set is
  // known, and only for orders that made the cut.
  const hits: { id: string; orderGroupId: string | null }[] = await prisma.labTest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 400,
    select: { id: true, orderGroupId: true },
  });

  /** Order keys in the sequence they should appear, deduped. */
  const keys: string[] = [];
  const grouped = new Set<string>();
  const solo = new Set<string>();
  for (const h of hits) {
    const key = h.orderGroupId ?? h.id;
    if (grouped.has(key) || solo.has(key)) continue;
    (h.orderGroupId ? grouped : solo).add(key);
    keys.push(key);
    if (keys.length >= 100) break;
  }
  if (keys.length === 0) return [];

  const rows: TestRow[] = await prisma.labTest.findMany({
    where: {
      OR: [
        ...(grouped.size ? [{ orderGroupId: { in: [...grouped] } }] : []),
        // A test from before orders existed: it is its own order, and it must
        // not swallow later tests that happen to have a null group.
        ...(solo.size ? [{ id: { in: [...solo] }, orderGroupId: null }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: testSelect,
  });

  const byKey = new Map<string, TestRow[]>();
  for (const r of rows) {
    const key = r.orderGroupId ?? r.id;
    const list = byKey.get(key);
    if (list) list.push(r); else byKey.set(key, [r]);
  }

  return keys.flatMap((key): LabOrderDTO[] => {
    const group = byKey.get(key);
    if (!group?.length) return [];
    const order = toOrderDTO(key, group);
    // Two of an order's four tests being released doesn't finish the order, so
    // it must not surface under Completed while it is still owed work.
    if (status === "COMPLETED" && order.pending > 0) return [];
    return [order];
  });
}

/** An order's rows, from its group id - or from a lone pre-orders test's own id. */
const orderWhere = (orderId: string) => ({
  // A test raised before orders existed is its own order, keyed by its id - and
  // must not sweep up every other ungrouped test with it.
  OR: [{ orderGroupId: orderId }, { id: orderId, orderGroupId: null }],
});

/** One order's row, built from the tests on it. */
function toOrderDTO(id: string, group: TestRow[]): LabOrderDTO {
  const tests = group.map(toTestDTO);
  const pending = tests.filter((t) => t.status === "PENDING").length;
  const priced = group.filter((g) => g.priceAtOrder != null);
  return {
    id,
    // The order was raised in one submit, so its first test's stamp is its own.
    createdAt: tests[0].createdAt,
    orderedAt: tests[0].orderedAt,
    patient: tests[0].patient,
    appointment: tests[0].appointment,
    referringDoctor: tests[0].referringDoctor,
    referringName: tests[0].referringName,
    tests,
    status: pending > 0 ? "PENDING" : "COMPLETED",
    pending,
    total: priced.length
      ? priced.reduce((s, g) => s + Number(g.priceAtOrder!.toString()), 0).toFixed(2)
      : null,
    billed: tests.every((t) => t.billed),
  };
}

/** One order, read back after it was changed. */
async function readLabOrder(orderId: string): Promise<LabOrderDTO> {
  const rows: TestRow[] = await prisma.labTest.findMany({
    where: orderWhere(orderId), orderBy: { createdAt: "asc" }, select: testSelect,
  });
  if (rows.length === 0) throw new ApiError(404, "Order not found");
  return toOrderDTO(orderId, rows);
}

/**
 * The referring doctor a lab order should actually carry.
 *
 * Two rules, both of them about not printing a doctor's name on a report they
 * never asked for:
 *
 *  * A test raised off a CONSULTATION already has a referring doctor - the one
 *    who saw the patient. A second name typed beside it would put two doctors
 *    on one "Ref. Doctor" line, so it is dropped.
 *  * A doctor id that doesn't resolve to an active doctor is rejected rather
 *    than silently stored: a dangling id prints as no doctor at all, which
 *    reads on paper exactly like nobody having filled it in.
 */
async function resolveReferrer(
  appointmentId: string | undefined,
  referringDoctorId: string | undefined,
): Promise<{ referringDoctorId: string | null; referringName: string | null }> {
  const none = { referringDoctorId: null, referringName: null };
  if (appointmentId || !referringDoctorId) return none;

  // THE HOSPITAL REFERRING ITSELF. Not a doctor and not self-referral, so it
  // goes to the text column instead of the foreign key. The name is read from
  // config rather than hard-coded - it is the same name the letterhead prints,
  // and a hospital that renames itself must not have old reports disagree with
  // new ones on this line.
  if (isInHouseReferrer(referringDoctorId)) {
    const cfg = await prisma.hospitalConfig.findFirst({ select: { legalName: true } });
    return { referringDoctorId: null, referringName: cfg?.legalName?.trim() || "This hospital" };
  }

  const doctor = await prisma.doctor.findFirst({
    where: { id: referringDoctorId, active: true },
    select: { id: true },
  });
  if (!doctor) throw new ApiError(400, "That doctor is no longer on the roster");
  return { referringDoctorId: doctor.id, referringName: null };
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
  input: {
    patientId: string; catalogIds: string[]; appointmentId?: string;
    /**
     * The doctor who asked for these tests when no consultation here did - a
     * patient at the window with an outside chit. Ignored when the order is
     * linked to a visit, which carries its own doctor.
     */
    referringDoctorId?: string;
    /**
     * The doctor's advised rows this order fulfils, keyed by catalog id. Passing
     * them is what closes the loop back to the OPD sheet, so the advice stops
     * showing as outstanding. Optional - a walk-in order has no advice behind it.
     */
    fromAdvised?: { advisedLabId: string; catalogId: string }[];
  },
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

  // The referring doctor only means anything where there is no visit to take
  // one from - a visit's own doctor IS the referrer, and storing a second name
  // beside it is how a report ends up citing two.
  const referrer = await resolveReferrer(
    admission ? undefined : input.appointmentId,
    input.referringDoctorId,
  );

  // Everything picked in this submit is ONE order, whatever it cost or however
  // many tubes it takes. Minted here rather than derived later from timestamps
  // because two orders for the same patient a second apart are two jobs, and
  // nothing after the fact can tell them apart.
  const orderGroupId = randomUUID();

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ids: string[] = [];
    /** catalogId -> the LabTest just raised for it, so advice can be linked. */
    const byCatalog = new Map<string, string>();
    for (const c of catalog) {
      const t = await tx.labTest.create({
        data: {
          orderGroupId,
          patientId: input.patientId,
          // an inpatient's test hangs off the STAY; an outpatient's off the visit
          appointmentId: admission ? null : (input.appointmentId ?? null),
          admissionId: admission?.id ?? null,
          referringDoctorId: referrer.referringDoctorId,
          referringName: referrer.referringName,
          catalogId: c.id,
          testName: c.name,
          priceAtOrder: c.price, // snapshot - survives catalog price changes
          status: "PENDING",
        },
        select: { id: true },
      });
      ids.push(t.id);
      byCatalog.set(c.id, t.id);

      // An inpatient's investigations get their own LAB bill, raised after this
      // transaction closes - see below. They are NOT posted to the room tab any
      // more: labs, pharmacy and the stay are three separate bills, each
      // settled on its own.
    }
    await logAudit(actor, {
      action: admission ? "LAB_TESTS_ORDERED_IP" : "LAB_TESTS_ORDERED",
      targetTable: "LabTest", targetId: ids[0],
      meta: { count: ids.length, orderGroupId, patientId: input.patientId, ipNumber: admission?.ipNumber ?? null },
      ...ctx,
    }, tx);
    return { ids, byCatalog };
  });

  // Close the loop on the doctor's advice. AFTER the transaction and never
  // inside it: the order is the clinically important thing, and a bookkeeping
  // link must not be able to roll it back. linkAdvisedLabs swallows its own
  // failures for the same reason - an unlinked row just stays on the
  // outstanding list, which is visible and recoverable.
  if (input.fromAdvised?.length) {
    await linkAdvisedLabs(
      input.fromAdvised
        .map((a) => ({ advisedLabId: a.advisedLabId, labTestId: created.byCatalog.get(a.catalogId) ?? "" }))
        .filter((p) => p.labTestId)
    );
  }

  const rows: TestRow[] = await prisma.labTest.findMany({ where: { id: { in: created.ids } }, select: testSelect });

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
        //
        // `labTestId` ties each line back to the test it bills. It was missing,
        // and the gap was invisible until an insurance claim tried to assemble
        // one bill from both the tests and the invoices: with no link, nothing
        // could tell that "E.S.R the test" and "E.S.R the invoice line" were the
        // same ₹200, and the claim listed every investigation twice.
        lines: catalog.map((c) => ({
          description: c.name,
          qty: 1,
          unitPrice: Number(c.price.toString()),
          gstRatePct: 0,
          labTestId: created.byCatalog.get(c.id),
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

  // The lab's own queue is the point of this one: a sample can be collected the
  // moment the desk orders the test, without anybody pressing refresh. An
  // inpatient order also raises a due, so the ward screens listen too.
  await publishLive(
    admission
      ? [TOPICS.LABS, TOPICS.RECEPTION, TOPICS.IPD, TOPICS.ADMIN]
      : [TOPICS.LABS, TOPICS.RECEPTION, TOPICS.ADMIN],
    EVENTS.LAB_ORDERED,
    rows.length
  );
  return dtos;
}

/**
 * The instant a corrected registration date means.
 *
 * The desk picks a DAY - a date field is what a counter can fill in without
 * fumbling - but the column is a real instant and the report prints a clock
 * time beside it ("Aug 01, 2026, 6:40 p.m."). So a date-only correction keeps
 * the time of day it is replacing: the day was wrong, the hour was not, and
 * defaulting to midnight would print every back-dated sample as having been
 * registered at 12:00 a.m.
 *
 * Local components throughout, because this is a timestamp and not a
 * date-only column - see the note at the top of lib/date.
 */
function parseOrderedAt(value: string, base: Date): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const when = parseLocalDate(value);
    when.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
    if (Number.isNaN(when.getTime())) throw new ApiError(400, "That isn't a date");
    return when;
  }
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new ApiError(400, "That isn't a date");
  return when;
}

/**
 * CORRECT AN ORDER THAT IS ALREADY RAISED - the referring doctor, the date, or
 * both.
 *
 * Two things get filled in wrong at a busy window, and both of them print:
 *
 *  * NO DOCTOR. The chit is in the patient's hand, the desk is three deep, and
 *    the order goes in as a walk-in. The report then reads "Ref. Doctor: Self /
 *    walk-in" and goes back to a doctor who is not named on it.
 *  * THE WRONG DAY. A sample taken on Saturday evening is typed in on Monday,
 *    and "Registered On" says Monday.
 *
 * Both apply to the WHOLE order, never to one test inside it: the tests on an
 * order came off one tube on one day against one chit, and a report that
 * disagreed with its siblings about either would be the harder bug to see.
 *
 * What this cannot do is move a test onto a different patient or a different
 * visit - those are the things a re-order exists for, and quietly rewriting
 * them here would leave an invoice pointing at a test that is no longer the one
 * that was billed.
 */
export async function updateLabOrder(
  actor: AuthUser,
  input: {
    orderId: string;
    /** A doctor id to name, or null to clear the one on it. Omit to leave alone. */
    referringDoctorId?: string | null;
    /** ISO date to register the order under, or null to fall back to createdAt. */
    orderedAt?: string | null;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<LabOrderDTO> {
  const tests = await prisma.labTest.findMany({
    where: orderWhere(input.orderId),
    orderBy: { createdAt: "asc" },
    select: { id: true, appointmentId: true, createdAt: true, orderedAt: true },
  });
  if (tests.length === 0) throw new ApiError(404, "Order not found");

  const data: { referringDoctorId?: string | null; referringName?: string | null; orderedAt?: Date | null } = {};

  if (input.referringDoctorId !== undefined) {
    // A test off a consultation already carries that doctor as its referrer -
    // see resolveReferrer. Refused rather than ignored, so a desk that thinks it
    // has renamed the doctor on a report finds out here and not on paper.
    if (input.referringDoctorId && tests.some((t) => t.appointmentId)) {
      throw new ApiError(400, "This order came off a consultation - its doctor is the one who saw the patient");
    }
    // BOTH are written every time, so switching between a doctor, the hospital
    // and self-referral always clears whichever the previous answer had set.
    const r = input.referringDoctorId
      ? await resolveReferrer(undefined, input.referringDoctorId)
      : { referringDoctorId: null, referringName: null };
    data.referringDoctorId = r.referringDoctorId;
    data.referringName = r.referringName;
  }

  if (input.orderedAt !== undefined) {
    if (input.orderedAt === null) {
      data.orderedAt = null;
    } else {
      const when = parseOrderedAt(input.orderedAt, tests[0].orderedAt ?? tests[0].createdAt);
      // A sample cannot have been registered tomorrow. The other end is left
      // open on purpose: an old order being tidied up is a real thing, and the
      // desk knows the date better than any bound this code could pick.
      const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
      if (when > endOfToday) throw new ApiError(400, "A sample can't be registered in the future");
      data.orderedAt = when;
    }
  }

  if (Object.keys(data).length === 0) throw new ApiError(400, "Nothing to change");

  await prisma.labTest.updateMany({ where: orderWhere(input.orderId), data });
  await logAudit(actor, {
    action: "LAB_ORDER_UPDATED", targetTable: "LabTest", targetId: tests[0].id,
    meta: { orderId: input.orderId, tests: tests.length, ...data },
    ...ctx,
  });

  // The order's own row, the queue's list and any report open on it all read
  // the doctor and the date - so everyone watching gets the correction.
  await publishLive([TOPICS.LABS, TOPICS.RECEPTION, TOPICS.ADMIN], EVENTS.LAB_ORDERED);
  return readLabOrder(input.orderId);
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

  // A report on the file is what reception hands the patient.
  await publishLive([TOPICS.LABS, TOPICS.RECEPTION, TOPICS.DOCTOR, TOPICS.ADMIN], EVENTS.LAB_RESULTED);

  const row: TestRow | null = await prisma.labTest.findUnique({ where: { id: input.labTestId }, select: testSelect });
  if (!row) throw new ApiError(404, "Test not found");
  return toTestDTO(row);
}

/** Mark a test completed without a file (result given on paper). */
export async function completeTest(actor: AuthUser, labTestId: string, ctx: { ipAddress?: string; userAgent?: string }): Promise<LabTestDTO> {
  const test = await prisma.labTest.findUnique({
    where: { id: labTestId },
    select: {
      id: true, status: true, testName: true,
      patient: { select: { displayId: true, fullName: true, phone: true } },
    },
  });
  if (!test) throw new ApiError(404, "Test not found");
  if (test.status === "COMPLETED") throw new ApiError(400, "This test is already completed");

  await prisma.labTest.update({
    where: { id: labTestId },
    data: { status: "COMPLETED", completedAt: new Date(), technicianId: actor.id },
  });
  await logAudit(actor, { action: "LAB_TEST_COMPLETED", targetTable: "LabTest", targetId: labTestId, ...ctx });

  // A finished result is something reception is actively waiting on.
  await publishLive([TOPICS.LABS, TOPICS.RECEPTION, TOPICS.DOCTOR, TOPICS.ADMIN], EVENTS.LAB_RESULTED);

  // "Come and collect it" - never the value itself. See notifyLabReportReady.
  // The guard above means this fires once per test: a second call is a 400.
  //
  // `patient` is nullable on LabTest despite the schema comment saying otherwise,
  // so there is genuinely nobody to text on a row that lost its link. Silent skip
  // rather than a crash: the result is saved either way, and a failed text must
  // never be the thing that stops a report being signed off.
  if (test.patient) {
    await notifyLabReportReady(test.patient.phone, {
      name: test.patient.fullName,
      testName: test.testName,
      reference: test.patient.displayId,
    });
  }

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
    /** The bench's read of these numbers - see LabTest.impression. */
    impression: string | null;
    technicianName: string | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null } | null;
  };
  results: LabResultDTO[];
  fromTemplate: boolean;
}> {
  const t = await prisma.labTest.findUnique({
    where: { id: labTestId },
    select: {
      id: true, testName: true, status: true, completedAt: true, catalogId: true, impression: true,
      technician: { select: { name: true } },
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
      impression: t.impression,
      technicianName: t.technician?.name ?? null,
      patient: t.patient,
    },
    results,
    fromTemplate,
  };
}

/**
 * The measured values for MANY tests at once, keyed by test id.
 *
 * The one query matters: every screen that lists a patient's investigations
 * would otherwise fetch results per row, and a patient with thirty tests on
 * file would cost thirty round trips to render one page.
 *
 * Returns a bare map - a test with no entered values simply isn't a key, so
 * callers read `map[id] ?? []` and never branch on "has results".
 */
export async function resultsForTests(labTestIds: string[]): Promise<Record<string, LabResultDTO[]>> {
  if (labTestIds.length === 0) return {};

  const rows = await prisma.labResultItem.findMany({
    where: { labTestId: { in: labTestIds } },
    orderBy: [{ labTestId: "asc" }, { sortOrder: "asc" }],
  });

  type Row = {
    labTestId: string; name: string; unit: string | null; value: string;
    refLow: unknown; refHigh: unknown; refText: string | null; flag: string; sortOrder: number;
  };

  const byTest: Record<string, LabResultDTO[]> = {};
  for (const r of rows as Row[]) {
    (byTest[r.labTestId] ??= []).push({
      name: r.name, unit: r.unit, value: r.value,
      refLow: dec(r.refLow as { toString(): string } | null),
      refHigh: dec(r.refHigh as { toString(): string } | null),
      refText: r.refText, flag: r.flag as LabResultFlagT, sortOrder: r.sortOrder,
    });
  }
  return byTest;
}

/** How many lines on a sheet are out of range - what a doctor scans for first. */
export function abnormalCount(results: LabResultDTO[]): number {
  return results.filter((r) => r.flag !== "NORMAL").length;
}

/**
 * Everything the PRINTED lab report needs, in one call.
 *
 * The same relationship the OPD sheet has to a visit: this is not a generated
 * document stored anywhere, it is the live view of the LabResultItem rows the
 * bench saved. Reprint it a year later and it prints what was measured, with
 * the range it was judged against, because both were snapshot onto the row at
 * save time.
 *
 * Everything a report has to carry to be a valid document is here in one
 * payload - who the patient is, who asked for the test, what was measured,
 * against what range, who signed it off and when - so the sheet renders in one
 * pass and can't half-load into a report that looks complete but isn't.
 */
export interface LabReportDTO {
  hospital: {
    legalName: string; addressLine: string; city: string; state: string; stateCode: string;
    pincode: string; gstin: string | null; phone: string | null;
    logoDataUrl?: string | null;
  } | null;
  test: {
    id: string; testName: string;
    /** Catalogue code - drives the specimen line, and prints as the test code. */
    code: string | null;
    /**
     * The section band the catalogue says to print, or null when it says
     * nothing and the transcribed map decides. See bandFor in lib/lab-reference
     * - "" here is a real answer ("no band"), not a missing one.
     */
    group: string | null;
    status: string;
    /** When the sample was registered, i.e. when the test was ordered. */
    orderedAt: string;
    completedAt: string | null;
    impression: string | null;
    technicianName: string | null;
    reportFileUrl: string | null;
  };
  patient: {
    displayId: string; fullName: string; age: number | null; gender: string | null;
    bloodGroup: string | null; phone: string; address: string | null; city: string | null;
  } | null;
  /** The visit that asked for it - a walk-in has none. */
  referral: { opNumber: string; doctorName: string; visitDate: string } | null;
  /**
   * The name for the report's "Ref. Doctor" line: the visit's doctor where
   * there was a visit, otherwise whoever the desk named on the order. Null only
   * when nobody referred the patient, which prints as "Self / walk-in".
   */
  refDoctorName: string | null;
  /** The referring doctor's council number. The regulations name lab reports
   *  alongside prescriptions and receipts. Null when the referrer is not a
   *  doctor on the roster - the hospital itself, or a walk-in. */
  refDoctorRegNo: string | null;
  /** Set when the test belongs to a stay rather than to a visit. */
  admission: { ipNumber: string } | null;
  results: LabResultDTO[];
  abnormal: number;
}

export async function labReportData(labTestId: string): Promise<LabReportDTO> {
  const t = await prisma.labTest.findUnique({
    where: { id: labTestId },
    select: {
      id: true, testName: true, status: true, createdAt: true, orderedAt: true, completedAt: true,
      impression: true, reportFileUrl: true,
      catalog: { select: { code: true, group: true } },
      technician: { select: { name: true } },
      referringDoctor: { select: { name: true, registrationNo: true } },
      // The non-doctor referrer - the hospital itself, most often. Feeds the
      // Ref. Doctor line below when there is no doctor to name.
      referringName: true,
      patient: {
        select: {
          displayId: true, fullName: true, age: true, gender: true,
          bloodGroup: true, phone: true, address: true, city: true,
        },
      },
      appointment: {
        select: {
          opNumber: true, visitDate: true,
          doctor: { select: { name: true, registrationNo: true } },
          patient: {
            select: {
              displayId: true, fullName: true, age: true, gender: true,
              bloodGroup: true, phone: true, address: true, city: true,
            },
          },
        },
      },
      admission: { select: { ipNumber: true } },
      results: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!t) throw new ApiError(404, "Test not found");

  const hospital = await prisma.hospitalConfig.findFirst();

  type Row = {
    name: string; unit: string | null; value: string; refLow: unknown; refHigh: unknown;
    refText: string | null; flag: string; sortOrder: number;
  };
  const results: LabResultDTO[] = (t.results as Row[]).map((r) => ({
    name: r.name, unit: r.unit, value: r.value,
    refLow: dec(r.refLow as { toString(): string } | null),
    refHigh: dec(r.refHigh as { toString(): string } | null),
    refText: r.refText, flag: r.flag as LabResultFlagT, sortOrder: r.sortOrder,
  }));

  return {
    hospital,
    test: {
      id: t.id, testName: t.testName, code: t.catalog?.code ?? null,
      // A walk-in raised against no catalogue row has no opinion to carry, and
      // null is the right answer for it - the map still gets its turn.
      group: t.catalog?.group ?? null,
      status: t.status,
      // The desk's correction where it made one - see LabTest.orderedAt. What
      // this prints as is "Registered On", and the patient can read it.
      orderedAt: (t.orderedAt ?? t.createdAt).toISOString(),
      completedAt: t.completedAt ? t.completedAt.toISOString() : null,
      impression: t.impression,
      technicianName: t.technician?.name ?? null,
      reportFileUrl: t.reportFileUrl,
    },
    // Walk-in tests carry the patient directly; a test ordered off a chit
    // reaches them through the visit. Same fallback as the queue rows.
    patient: t.patient ?? t.appointment?.patient ?? null,
    referral: t.appointment
      ? {
          opNumber: t.appointment.opNumber,
          doctorName: t.appointment.doctor?.name ?? DUTY_DOCTOR.name,
          visitDate: t.appointment.visitDate.toISOString().slice(0, 10),
        }
      : null,
    admission: t.admission ? { ipNumber: t.admission.ipNumber } : null,
    // The visit's doctor first: where a consultation asked for the test, the
    // doctor who saw the patient IS the referrer, and the order's own field is
    // only ever filled in when there was no consultation to ask.
    // The visit's doctor, then the named doctor, then whoever else was recorded
    // as the referrer - the hospital itself, most often. Null prints as
    // "Self / walk-in", which must now mean it, rather than meaning "we had
    // nowhere to put the answer".
    refDoctorName: t.appointment
      ? (t.appointment.doctor?.name ?? DUTY_DOCTOR.name)
      : (t.referringDoctor?.name ?? t.referringName ?? null),
    // Follows refDoctorName step for step, and is null wherever that falls back
    // to a role or a plain typed name: a number printed beside the wrong person
    // is worse on a report than no number at all. `referringName` is free text
    // with nobody behind it, so it never carries one.
    refDoctorRegNo: t.appointment
      ? (t.appointment.doctor?.registrationNo ?? null)
      : (t.referringDoctor?.registrationNo ?? null),
    results,
    abnormal: abnormalCount(results),
  };
}

export interface LabOrderReportDTO {
  /** The order these reports belong to - its group id, or a lone test's id. */
  orderId: string;
  /**
   * One report per test on the order, in the sequence it was ordered.
   *
   * Tests with nothing entered yet are INCLUDED rather than filtered out here:
   * the screen has to be able to say "two of these four have no values, they
   * won't print" and it can only say it about tests it was told exist. What
   * reaches paper is the print page's decision.
   */
  reports: LabReportDTO[];
}

/**
 * Every report on one order, for printing as a single document.
 *
 * The reports are read one per test rather than in a single wide query: this is
 * a print page opened a handful of times a day, and each report is the same
 * bundle the single-report route already returns - so the sheets an order
 * prints are, line for line, the sheets each test prints on its own. A faster
 * query that built them a second way would be a second layout waiting to
 * happen.
 */
export async function labOrderReportData(orderId: string): Promise<LabOrderReportDTO> {
  const tests = await prisma.labTest.findMany({
    where: orderWhere(orderId),
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (tests.length === 0) throw new ApiError(404, "Order not found");

  return {
    orderId,
    reports: await Promise.all(tests.map((t: { id: string }) => labReportData(t.id))),
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
  input: { labTestId: string; items: LabResultInput[]; complete?: boolean; impression?: string | null },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ results: LabResultDTO[]; abnormal: number; impression: string | null }> {
  const test = await prisma.labTest.findUnique({
    where: { id: input.labTestId },
    select: {
      id: true, testName: true, patientId: true,
      // `status` decides whether the "ready for collection" text goes out below:
      // a technician correcting a typo on an already-completed report must not
      // text the patient a second time.
      status: true,
      patient: { select: { displayId: true, fullName: true, phone: true } },
    },
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

  // `undefined` means "the caller didn't send the field" and must leave an
  // existing impression alone; an empty string is a technician deliberately
  // clearing what they wrote. Collapsing the two would silently wipe the note
  // every time an older client saved a correction to the numbers.
  const impression = input.impression === undefined ? undefined : (input.impression?.trim() || null);

  await prisma.$transaction(async (tx) => {
    await tx.labResultItem.deleteMany({ where: { labTestId: input.labTestId } });
    await tx.labResultItem.createMany({ data: prepared });
    if (input.complete !== false) {
      await tx.labTest.update({
        where: { id: input.labTestId },
        data: {
          status: "COMPLETED", completedAt: new Date(), technicianId: actor.id,
          ...(impression !== undefined ? { impression } : {}),
        },
      });
    } else if (impression !== undefined) {
      await tx.labTest.update({ where: { id: input.labTestId }, data: { impression } });
    }
  });

  const abnormal = prepared.filter((p) => (p.flag as unknown as string) !== "NORMAL").length;
  await logAudit(actor, {
    action: "LAB_RESULTS_SAVED", targetTable: "LabTest", targetId: input.labTestId,
    meta: { testName: test.testName, lines: prepared.length, abnormal, impression: impression ?? undefined },
    ...ctx,
  });

  const sheet = await labResultSheet(input.labTestId);
  // Reception and the doctor's queue both watch this: an impression written at
  // the bench is only useful if it reaches the consulting room before the
  // patient does.
  await publishLive([TOPICS.LABS, TOPICS.RECEPTION, TOPICS.DOCTOR, TOPICS.ADMIN], EVENTS.LAB_RESULTED);

  // Only on the transition into COMPLETED. Saving results without completing is
  // a bench in progress, and re-saving a completed report is a correction -
  // neither is news to the patient, and texting on every save would send four
  // messages for one report.
  if (input.complete && test.status !== "COMPLETED" && test.patient) {
    await notifyLabReportReady(test.patient.phone, {
      name: test.patient.fullName,
      testName: test.testName,
      reference: test.patient.displayId,
    });
  }

  return { results: sheet.results, abnormal, impression: sheet.test.impression };
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

// ─────────────────────────────────────────────────────────────────────────────
// THE WALK-IN COUNTER
//
// Somebody arrives with a chit and no file. Registering them, ordering the
// tests and taking the money is ONE transaction at the window even though it is
// three rows in three tables, and the lab desk should not have to drive three
// screens to record it.
// ─────────────────────────────────────────────────────────────────────────────

export interface WalkInPatientDTO {
  id: string; displayId: string; fullName: string; phone: string;
  age: number | null; gender: string | null;
  /** True when this record was created by THIS call - the UI says so on the receipt. */
  isNew: boolean;
}

export interface WalkInResultDTO {
  patient: WalkInPatientDTO;
  /** The tests ordered by this call. Empty when only pre-existing ones were billed. */
  tests: LabTestDTO[];
  /** Null when no bill was asked for, or when the charge went to a room tab. */
  invoice: InvoiceDTO | null;
  /**
   * The patient is in a bed, so the tests raised their own bill due at
   * discharge and NO money is taken at the counter. The UI has to say this out
   * loud or the desk asks an inpatient's family to pay twice.
   */
  chargedToRoom: boolean;
}

/**
 * Register (if new), order, and bill - in that order, in one call.
 *
 * Each step keeps its own transaction. They are deliberately NOT wrapped in an
 * outer one: `createInvoice` opens its own, and nesting would hold a write lock
 * across a registration and an order for the whole time. The steps are ordered
 * so a failure leaves the least damage - a registered patient with no tests is
 * a harmless empty record, and ordered-but-unbilled tests are exactly what the
 * Billing page exists to clear. Only the last step can fail with work already
 * done, and it says so in the error rather than leaving the desk guessing.
 */
export async function walkInOrder(
  actor: AuthUser,
  input: {
    patientId?: string;
    newPatient?: {
      firstName: string; lastName?: string; phone: string;
      age?: number; gender?: "MALE" | "FEMALE" | "OTHER";
    };
    catalogIds: string[];
    labTestIds: string[];
    /** The doctor on the chit they walked in with, when they walked in with one. */
    referringDoctorId?: string;
    bill?: {
      discountAmount?: number;
      payments?: { mode: "CASH" | "UPI" | "CARD" | "NETBANKING" | "OTHER"; amount: number; reference?: string }[];
    };
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<WalkInResultDTO> {
  // ---- 1. who ----
  let patient: WalkInPatientDTO;
  if (input.newPatient) {
    const created = await registerPatient(
      actor,
      {
        firstName: input.newPatient.firstName,
        lastName: input.newPatient.lastName,
        phone: input.newPatient.phone,
        age: input.newPatient.age,
        gender: input.newPatient.gender,
        isVip: false,
      },
      ctx
    );
    patient = {
      id: created.id, displayId: created.displayId, fullName: created.fullName,
      phone: created.phone, age: created.age, gender: created.gender, isNew: true,
    };
  } else {
    const found = await prisma.patient.findUnique({
      where: { id: input.patientId ?? "" },
      select: { id: true, displayId: true, fullName: true, phone: true, age: true, gender: true, mergedIntoId: true, deletedAt: true },
    });
    if (!found || found.mergedIntoId || found.deletedAt) throw new ApiError(404, "Patient not found");
    patient = {
      id: found.id, displayId: found.displayId, fullName: found.fullName,
      phone: found.phone, age: found.age, gender: found.gender, isNew: false,
    };
  }

  // ---- 2. what ----
  let tests: LabTestDTO[] = [];
  let chargedToRoom = false;
  if (input.catalogIds.length > 0) {
    const ordered = await orderTests(
      actor,
      { patientId: patient.id, catalogIds: input.catalogIds, referringDoctorId: input.referringDoctorId },
      ctx,
    );
    chargedToRoom = !!ordered.chargedToRoom;
    tests = [...ordered];
  }

  // ---- 3. the money ----
  //
  // Skipped entirely for an inpatient: orderTests already raised their LAB bill
  // against the stay, and billing again here would charge the same tests twice.
  let invoice: InvoiceDTO | null = null;
  if (input.bill && !chargedToRoom) {
    const labTestIds = [...tests.map((t) => t.id), ...input.labTestIds];
    try {
      invoice = await billLabTests(
        actor,
        {
          patientId: patient.id,
          labTestIds,
          discountAmount: input.bill.discountAmount,
          payments: input.bill.payments,
        },
        ctx
      );
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : "Could not generate the bill";
      // The tests exist and are findable; say where, so nobody re-orders them.
      if (tests.length > 0) {
        throw new ApiError(
          e instanceof ApiError ? e.status : 400,
          `${reason}. The ${tests.length === 1 ? "test is" : "tests are"} in the queue for ${patient.displayId} - raise the bill from the Billing page.`
        );
      }
      throw e;
    }
  }

  return { patient, tests, invoice, chargedToRoom };
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

  // The counter is asked "what did it say?" far more often than "where's the
  // PDF?" - carry the numbers, not just the file link.
  const byTest = await resultsForTests((tests as TestRow[]).map((t) => t.id));

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
    tests: (tests as TestRow[]).map((t) => {
      const results = byTest[t.id] ?? [];
      return { ...toTestDTO(t), results, abnormal: abnormalCount(results) };
    }),
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
