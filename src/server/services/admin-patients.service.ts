import { prisma } from "@/lib/prisma";
import { owed } from "@/lib/money-round";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import type { AuthUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

/**
 * ADMIN patient register - the management view of the people the hospital has
 * seen, with the two numbers a manager actually asks for: how often they came
 * and what they were billed.
 *
 * WHY A SEPARATE SERVICE FROM reception.service
 * ---------------------------------------------
 * `PatientDTO` there deliberately omits `referredByName` / `referralSource`,
 * with a comment saying one serializer means the admin-only fact can never leak
 * from a desk response. Widening that DTO to carry referral would defeat it, so
 * the admin view gets its own serializer instead. The rule holds: referral
 * appears in exactly one place, and that place is behind requireRole("ADMIN").
 *
 * MONEY DEFINITION - must reconcile with adminOverview
 * ----------------------------------------------------
 * Revenue is `sum(Invoice.totalAmount)` over invoices whose status is not
 * CANCELLED, and outstanding is that total minus payments received on invoices
 * still PENDING or PARTIALLY_PAID. Both match `adminOverview` exactly. If these
 * two ever disagree, the per-patient rows stop adding up to the dashboard and
 * both numbers lose their authority - so they are deliberately the same rule,
 * not two independently reasonable ones.
 *
 * Note REFUNDED invoices still count toward revenue here, because that is what
 * adminOverview does. Refunds are tracked on their own model.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: { toString(): string }) => Number(v.toString());
const money = (n: number) => n.toFixed(2);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Revenue counts every invoice that was not cancelled. */
const REVENUE_INVOICE: Prisma.InvoiceWhereInput = { status: { not: "CANCELLED" } };
/** A visit is any appointment that was not cancelled. */
const REAL_VISIT: Prisma.AppointmentWhereInput = { status: { not: "CANCELLED" } };

export interface AdminPatientRow {
  id: string;
  displayId: string;
  fullName: string;
  age: number | null;
  gender: string | null;
  phone: string;
  city: string | null;
  visits: number;
  revenue: string;
  outstanding: string;
  lastVisit: string | null;
  registeredAt: string;
  isVip: boolean;
  isDeceased: boolean;
  archived: boolean;
}

export interface AdminPatientListQuery {
  q?: string;
  /** Archived patients are hidden unless asked for. */
  includeArchived?: boolean;
  sort?: "recent" | "name" | "revenue";
  page?: number;
  pageSize?: number;
}

const listSelect = {
  id: true, displayId: true, fullName: true, age: true, gender: true, phone: true,
  city: true, createdAt: true, isVip: true, isDeceased: true, deletedAt: true,
} as const;

function buildWhere(q: string | undefined, includeArchived: boolean): Prisma.PatientWhereInput {
  const where: Prisma.PatientWhereInput = {
    // A merged record is a duplicate that has already been folded into the
    // survivor. Showing it would double-count both the person and their money.
    mergedIntoId: null,
  };
  if (!includeArchived) where.deletedAt = null;

  const term = q?.trim();
  if (term) {
    where.OR = [
      { fullName: { contains: term, mode: "insensitive" } },
      { displayId: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
  }
  return where;
}

/**
 * Per-patient totals for one page of patients.
 *
 * Aggregated for the page's ids in two queries rather than per row: a 25-row
 * page was otherwise 50 extra round trips, which is the difference between a
 * register that opens instantly and one a manager stops using.
 */
async function aggregateFor(ids: string[]) {
  if (ids.length === 0) {
    return { visitsBy: new Map<string, number>(), lastVisitBy: new Map<string, Date>(), revenueBy: new Map<string, number>(), outstandingBy: new Map<string, number>() };
  }

  const [visitAgg, invoices] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["patientId"],
      where: { patientId: { in: ids }, ...REAL_VISIT },
      _count: { _all: true },
      _max: { visitDate: true },
    }),
    prisma.invoice.findMany({
      where: { patientId: { in: ids }, ...REVENUE_INVOICE },
      select: { patientId: true, totalAmount: true, status: true, payments: { select: { amount: true } } },
    }),
  ]);

  const visitsBy = new Map<string, number>();
  const lastVisitBy = new Map<string, Date>();
  for (const v of visitAgg) {
    visitsBy.set(v.patientId, v._count._all);
    if (v._max.visitDate) lastVisitBy.set(v.patientId, v._max.visitDate);
  }

  const revenueBy = new Map<string, number>();
  const outstandingBy = new Map<string, number>();
  for (const i of invoices) {
    revenueBy.set(i.patientId, r2((revenueBy.get(i.patientId) ?? 0) + num(i.totalAmount)));
    if (i.status === "PENDING" || i.status === "PARTIALLY_PAID") {
      const paid = i.payments.reduce((s, p) => r2(s + num(p.amount)), 0);
      const due = owed(Math.max(0, r2(num(i.totalAmount) - paid)));
      outstandingBy.set(i.patientId, r2((outstandingBy.get(i.patientId) ?? 0) + due));
    }
  }

  return { visitsBy, lastVisitBy, revenueBy, outstandingBy };
}

/** The patient register: searchable, paged, with visit and money totals. */
export async function listAdminPatients(query: AdminPatientListQuery): Promise<{
  patients: AdminPatientRow[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
  const where = buildWhere(query.q, query.includeArchived ?? false);
  const sort = query.sort ?? "recent";

  let rows: Prisma.PatientGetPayload<{ select: typeof listSelect }>[];
  let total: number;

  if (sort === "revenue") {
    // Ordering by a SUM cannot come from the patient table, so the invoice rows
    // decide the order and the patient rows are fetched to match. A patient who
    // has never been billed has no row here and is therefore not in a
    // "highest billed first" list at all, which is the honest reading of it.
    const matching = await prisma.patient.findMany({ where, select: { id: true } });
    const allowed = matching.map((m) => m.id);
    const grouped = await prisma.invoice.groupBy({
      by: ["patientId"],
      where: { patientId: { in: allowed }, ...REVENUE_INVOICE },
      _sum: { totalAmount: true },
      orderBy: { _sum: { totalAmount: "desc" } },
    });
    total = grouped.length;
    const pageIds = grouped.slice((page - 1) * pageSize, page * pageSize).map((g) => g.patientId);
    const fetched = await prisma.patient.findMany({ where: { id: { in: pageIds } }, select: listSelect });
    const byId = new Map(fetched.map((f) => [f.id, f]));
    rows = pageIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  } else {
    const orderBy: Prisma.PatientOrderByWithRelationInput =
      sort === "name" ? { fullName: "asc" } : { createdAt: "desc" };
    [rows, total] = await Promise.all([
      prisma.patient.findMany({ where, select: listSelect, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.patient.count({ where }),
    ]);
  }

  const { visitsBy, lastVisitBy, revenueBy, outstandingBy } = await aggregateFor(rows.map((r) => r.id));

  return {
    page,
    pageSize,
    total,
    patients: rows.map((p) => ({
      id: p.id,
      displayId: p.displayId,
      fullName: p.fullName,
      age: p.age,
      gender: p.gender,
      phone: p.phone,
      city: p.city,
      visits: visitsBy.get(p.id) ?? 0,
      revenue: money(revenueBy.get(p.id) ?? 0),
      outstanding: money(outstandingBy.get(p.id) ?? 0),
      lastVisit: dateOnly(lastVisitBy.get(p.id)),
      registeredAt: p.createdAt.toISOString(),
      isVip: p.isVip,
      isDeceased: p.isDeceased,
      archived: p.deletedAt !== null,
    })),
  };
}

export interface AdminPatientDetail {
  profile: Record<string, unknown>;
  stats: {
    visits: number;
    completedVisits: number;
    cancelledVisits: number;
    revenue: string;
    outstanding: string;
    invoices: number;
    labTests: number;
    admissions: number;
    firstVisit: string | null;
    lastVisit: string | null;
  };
  visits: { id: string; opNumber: string; visitDate: string; time: string; status: string; doctorName: string; department: string }[];
  bills: { id: string; receiptNo: string; source: string; status: string; totalAmount: string; paid: string; createdAt: string }[];
  labTests: { id: string; name: string; status: string; createdAt: string }[];
}

/**
 * One patient, in full, for the admin console. This is the ONLY serializer that
 * carries the referral snapshot - see the note at the top of this file.
 */
export async function getAdminPatientDetail(displayId: string): Promise<AdminPatientDetail> {
  const p = await prisma.patient.findUnique({
    where: { displayId },
    select: {
      id: true, displayId: true, uuid: true, fullName: true, firstName: true, middleName: true,
      lastName: true, dob: true, age: true, gender: true, bloodGroup: true, maritalStatus: true,
      phone: true, alternatePhone: true, email: true, address: true, city: true, state: true,
      country: true, postalCode: true, occupation: true, nationality: true, preferredLanguage: true,
      emergencyContactName: true, emergencyContactRelation: true, emergencyContactPhone: true,
      allergies: true, govtIdNumber: true, referredByName: true, referralSource: true,
      isVip: true, isActive: true, isDeceased: true, deceasedAt: true, remarks: true,
      mergedIntoId: true, deletedAt: true, createdAt: true, updatedAt: true,
    },
  });
  // A merged record is not "a patient who is hidden", it is a pointer at the
  // survivor. Reads elsewhere already refuse it; this one does too.
  if (!p || p.mergedIntoId) throw new ApiError(404, "Patient not found");

  const [visitRows, invoiceRows, labRows, admissionCount] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: p.id },
      orderBy: { visitDate: "desc" },
      select: {
        id: true, opNumber: true, visitDate: true, timeAtBooking: true, status: true,
        doctor: { select: { name: true, department: true } },
      },
    }),
    // Every bill, uncapped: "Total billed" and "Outstanding" below are summed
    // from these rows, so a cap under-reported any patient with more than 50.
    prisma.invoice.findMany({
      where: { patientId: p.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, receiptNo: true, source: true, status: true, totalAmount: true,
        createdAt: true, payments: { select: { amount: true } },
      },
    }),
    prisma.labTest.findMany({
      where: { patientId: p.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, createdAt: true, catalog: { select: { name: true } } },
    }),
    prisma.admission.count({ where: { patientId: p.id } }),
  ]);

  const realVisits = visitRows.filter((v) => v.status !== "CANCELLED");
  const counted = invoiceRows.filter((i) => i.status !== "CANCELLED");
  const revenue = counted.reduce((s, i) => r2(s + num(i.totalAmount)), 0);
  const outstanding = counted
    .filter((i) => i.status === "PENDING" || i.status === "PARTIALLY_PAID")
    .reduce((s, i) => {
      const paid = i.payments.reduce((t, x) => r2(t + num(x.amount)), 0);
      return r2(s + Math.max(0, r2(num(i.totalAmount) - paid)));
    }, 0);

  const visitDates = realVisits.map((v) => v.visitDate).sort((a, b) => a.getTime() - b.getTime());

  return {
    profile: {
      ...p,
      dob: dateOnly(p.dob),
      deceasedAt: iso(p.deceasedAt),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
      archived: p.deletedAt !== null,
      archivedAt: iso(p.deletedAt),
    },
    stats: {
      visits: realVisits.length,
      completedVisits: visitRows.filter((v) => v.status === "COMPLETED").length,
      cancelledVisits: visitRows.filter((v) => v.status === "CANCELLED").length,
      revenue: money(revenue),
      outstanding: money(outstanding),
      invoices: counted.length,
      labTests: labRows.length,
      admissions: admissionCount,
      firstVisit: dateOnly(visitDates[0]),
      lastVisit: dateOnly(visitDates[visitDates.length - 1]),
    },
    visits: visitRows.map((v) => ({
      id: v.id,
      opNumber: v.opNumber,
      visitDate: v.visitDate.toISOString().slice(0, 10),
      time: v.timeAtBooking,
      status: v.status,
      doctorName: v.doctor?.name ?? "-",
      department: v.doctor?.department ?? "-",
    })),
    bills: invoiceRows.map((i) => ({
      id: i.id,
      receiptNo: i.receiptNo,
      source: i.source,
      status: i.status,
      totalAmount: money(num(i.totalAmount)),
      paid: money(i.payments.reduce((s, x) => r2(s + num(x.amount)), 0)),
      createdAt: i.createdAt.toISOString(),
    })),
    labTests: labRows.map((l) => ({
      id: l.id,
      name: l.catalog?.name ?? "-",
      status: l.status,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

/**
 * ARCHIVE, NOT DELETE.
 *
 * The schema's stated policy is that medical records are never hard-deleted:
 * patients are merged, not removed. A hard delete would also simply fail -
 * referential actions are left at Prisma's default of Restrict, so a patient
 * with a single invoice or appointment cannot be removed at all. More to the
 * point, a discharged patient's bill is a tax document and their case sheet is
 * a medico-legal record; the hospital does not get to make either disappear
 * because a clerk clicked delete.
 *
 * So this sets `deletedAt`, which every read in the codebase already treats as
 * "gone": the patient stops appearing in reception search, in the register, and
 * at the desk, while the history stays intact and reversible.
 *
 * If the intent is "this is the same human, registered twice", the right tool is
 * `mergePatients` in reception.service, not this.
 */
export async function setPatientArchived(
  actor: AuthUser,
  displayId: string,
  archived: boolean,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ displayId: string; archived: boolean }> {
  const existing = await prisma.patient.findUnique({
    where: { displayId },
    select: { id: true, deletedAt: true, mergedIntoId: true, fullName: true },
  });
  if (!existing || existing.mergedIntoId) throw new ApiError(404, "Patient not found");

  if (archived && existing.deletedAt) throw new ApiError(400, "This patient is already archived");
  if (!archived && !existing.deletedAt) throw new ApiError(400, "This patient is not archived");

  if (archived) {
    // Someone lying in a bed is not an archivable record. Hiding them would drop
    // them off the ward board and out of reception search while the ward still
    // has them, which is how a patient gets lost inside their own hospital.
    const admitted = await prisma.admission.count({
      where: { patientId: existing.id, status: "ADMITTED" },
    });
    if (admitted > 0) {
      throw new ApiError(409, "This patient is currently admitted. Discharge them before archiving.");
    }
  }

  await prisma.patient.update({
    where: { id: existing.id },
    data: { deletedAt: archived ? new Date() : null, updatedById: actor.id },
  });

  await logAudit(actor, {
    action: archived ? "PATIENT_ARCHIVED" : "PATIENT_RESTORED",
    targetTable: "Patient",
    targetId: existing.id,
    meta: { displayId, fullName: existing.fullName },
    ...ctx,
  });

  return { displayId, archived };
}
