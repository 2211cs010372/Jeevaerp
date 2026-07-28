import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { localDateISO, dateOnlyISO } from "@/lib/date";
import { logAudit } from "./audit.service";
import { DUTY_DOCTOR } from "./appointments.service";
import { collectionByMode, type ModeTotal } from "./reports.service";
import { pharmacyProfitSummary } from "./pharmacy.service";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import type { AuthUser } from "@/lib/auth/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Top-line numbers for the admin overview. */
export async function adminOverview(): Promise<{
  today: { appointments: number; completed: number; newPatients: number; revenue: string; labTests: number };
  totals: { patients: number; doctors: number; staff: number; invoices: number };
  revenueToday: string; revenueMtd: string; revenueYtd: string;
  bedOccupancy: { total: number; occupied: number; free: number };
  pharmacyAlerts: number;
  revenueBySource: { source: string; total: string }[];
  revenueByDoctor: { doctor: string; department: string; revenue: string; visits: number }[];
  pharmacyProfit: { profitToday: string; marginPct: number; stockValueCost: string; stockValueMrp: string; potentialProfit: string };
  collectionsByMode: ModeTotal[];
  last7Days: { date: string; appointments: number; revenue: number; sources: Record<string, number> }[];
  last14Days: { date: string; appointments: number; revenue: number; sources: Record<string, number> }[];
  revenueLastMonthToDate: string;
  last6Months: { label: string; revenue: number; sources: Record<string, number> }[];
  todayAppointments: { time: string; patient: string; doctor: string; dept: string; status: string }[];
  recentBills: { receiptNo: string; date: string; total: string; status: string; discountPct: number }[];
  outstanding: string;
}> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const fortnightAgo = new Date(today); fortnightAgo.setDate(today.getDate() - 13);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthCutoff = new Date(Math.min(new Date(today.getFullYear(), today.getMonth() - 1, today.getDate() + 1).getTime(), monthStart.getTime()));

  const [
    apptsToday, completedToday, newPatientsToday, invoicesToday, labTestsToday,
    totalPatients, totalDoctors, totalStaff, totalInvoices,
    allInvoices, weekAppts, unpaidInvoices,
    totalBeds, occupiedBeds, meds, todayApptRows, recentBillRows, docInvoices,
  ] = await Promise.all([
    prisma.appointment.count({ where: { visitDate: today, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { visitDate: today, status: "COMPLETED" } }),
    prisma.patient.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    prisma.invoice.findMany({ where: { createdAt: { gte: today, lt: tomorrow }, status: { not: "CANCELLED" } }, select: { totalAmount: true } }),
    prisma.labTest.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    prisma.patient.count({ where: { deletedAt: null, mergedIntoId: null } }),
    prisma.doctor.count({ where: { active: true } }),
    prisma.user.count({ where: { isActive: true, role: { not: "PATIENT" } } }),
    prisma.invoice.count(),
    prisma.invoice.findMany({ where: { status: { not: "CANCELLED" } }, select: { source: true, totalAmount: true, createdAt: true } }),
    prisma.appointment.findMany({ where: { visitDate: { gte: fortnightAgo, lt: tomorrow }, status: { not: "CANCELLED" } }, select: { visitDate: true } }),
    prisma.invoice.findMany({ where: { status: { in: ["PENDING", "PARTIALLY_PAID"] } }, select: { totalAmount: true, payments: { select: { amount: true } } } }),
    prisma.bed.count(),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.medicine.findMany({ select: { reorderThreshold: true, batches: { select: { quantity: true } } } }),
    prisma.appointment.findMany({ where: { visitDate: today, status: { not: "CANCELLED" } }, orderBy: { timeAtBooking: "asc" }, take: 12, select: { timeAtBooking: true, status: true, patient: { select: { fullName: true } }, doctor: { select: { name: true, department: true } } } }),
    prisma.invoice.findMany({ where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 8, select: { receiptNo: true, createdAt: true, totalAmount: true, status: true, subtotal: true, discountAmount: true } }),
    prisma.invoice.findMany({ where: { status: { not: "CANCELLED" }, OR: [{ appointmentId: { not: null } }, { admissionId: { not: null } }] }, select: { totalAmount: true, appointment: { select: { doctor: { select: { name: true, department: true } } } }, admission: { select: { doctor: { select: { name: true, department: true } } } } } }),
  ]);

  const num = (v: { toString(): string }) => Number(v.toString());
  const allInv = allInvoices as { source: string; totalAmount: { toString(): string }; createdAt: Date }[];

  const revToday = invoicesToday.reduce((s: number, i: { totalAmount: { toString(): string } }) => r2(s + num(i.totalAmount)), 0);
  const revMtd = allInv.filter((i) => i.createdAt >= monthStart).reduce((s, i) => r2(s + num(i.totalAmount)), 0);
  const revYtd = allInv.filter((i) => i.createdAt >= yearStart).reduce((s, i) => r2(s + num(i.totalAmount)), 0);

  // revenue by source
  const bySource = new Map<string, number>();
  for (const i of allInv) bySource.set(i.source, r2((bySource.get(i.source) ?? 0) + num(i.totalAmount)));

  // 14-day daily series (sparklines + week-over-week) - from allInv + appts
  // Split any invoice set into per-source revenue (OPD / pharmacy / labs /
  // inpatient / other) - powers the multi-line revenue trend.
  const SRC_KEYS = ["CONSULTATION", "PHARMACY", "LAB", "IPD", "OTHER"] as const;
  const bucketSources = (invs: typeof allInv): Record<string, number> => {
    const o: Record<string, number> = { CONSULTATION: 0, PHARMACY: 0, LAB: 0, IPD: 0, OTHER: 0 };
    for (const i of invs) {
      const k = (SRC_KEYS as readonly string[]).includes(i.source) ? i.source : "OTHER";
      o[k] = r2(o[k] + num(i.totalAmount));
    }
    return o;
  };

  const fortInv = allInv.filter((i) => i.createdAt >= fortnightAgo);
  const series: { date: string; appointments: number; revenue: number; sources: Record<string, number> }[] = [];
  for (let d = 13; d >= 0; d--) {
    const day = new Date(today); day.setDate(today.getDate() - d);
    // The bucket label is a LOCAL calendar day. visitDate is a date-only column
    // (UTC midnight of its day); createdAt is a real instant, so it has to be
    // read in clinic-local time or a 10 PM bill lands in yesterday's bar.
    const key = localDateISO(day);
    const appts = (weekAppts as { visitDate: Date }[]).filter((a) => dateOnlyISO(a.visitDate) === key).length;
    const dayInv = fortInv.filter((i) => localDateISO(i.createdAt) === key);
    const rev = dayInv.reduce((s, i) => r2(s + num(i.totalAmount)), 0);
    series.push({ date: key, appointments: appts, revenue: rev, sources: bucketSources(dayInv) });
  }

  // last month, same day-of-month range - for a fair month-to-date comparison
  const revLastMonthToDate = allInv
    .filter((i) => i.createdAt >= lastMonthStart && i.createdAt < lastMonthCutoff)
    .reduce((s, i) => r2(s + num(i.totalAmount)), 0);

  // last 6 months (monthly) - derived from allInv
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sixMoInv = allInv.filter((i) => i.createdAt >= sixMonthsAgo);
  const months: { label: string; revenue: number; sources: Record<string, number> }[] = [];
  for (let m = 5; m >= 0; m--) {
    const dt = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const mInv = sixMoInv.filter((i) => i.createdAt.getFullYear() === dt.getFullYear() && i.createdAt.getMonth() === dt.getMonth());
    const rev = mInv.reduce((s, i) => r2(s + num(i.totalAmount)), 0);
    months.push({ label: MONTHS[dt.getMonth()], revenue: rev, sources: bucketSources(mInv) });
  }

  // outstanding = billed but not fully paid
  const outstanding = (unpaidInvoices as { totalAmount: { toString(): string }; payments: { amount: { toString(): string } }[] }[])
    .reduce((s, i) => {
      const paid = i.payments.reduce((p, x) => r2(p + num(x.amount)), 0);
      return r2(s + Math.max(0, num(i.totalAmount) - paid));
    }, 0);

  // pharmacy stock alerts (batch qty at/below reorder)
  const pharmacyAlerts = (meds as { reorderThreshold: number; batches: { quantity: number }[] }[])
    .filter((mm) => mm.batches.reduce((s, b) => s + b.quantity, 0) <= mm.reorderThreshold).length;

  const todayAppointments = (todayApptRows as { timeAtBooking: string; status: string; patient: { fullName: string }; doctor: { name: string; department: string } | null }[])
    .map((a) => ({ time: a.timeAtBooking, patient: a.patient.fullName, doctor: a.doctor?.name ?? DUTY_DOCTOR.name, dept: a.doctor?.department ?? DUTY_DOCTOR.department, status: a.status }));

  const recentBills = (recentBillRows as { receiptNo: string; createdAt: Date; totalAmount: { toString(): string }; status: string; subtotal: { toString(): string }; discountAmount: { toString(): string } }[])
    .map((b) => {
      const sub = num(b.subtotal), disc = num(b.discountAmount);
      return {
        receiptNo: b.receiptNo,
        date: b.createdAt.toISOString().slice(0, 10),
        total: num(b.totalAmount).toFixed(2),
        status: b.status,
        discountPct: sub > 0 ? Math.round((disc / sub) * 100) : 0,
      };
    });

  // revenue by doctor - consultation (via appointment.doctor) + IPD (via admission.doctor)
  type DocInv = { totalAmount: { toString(): string }; appointment: { doctor: { name: string; department: string } | null } | null; admission: { doctor: { name: string; department: string } } | null };
  const docMap = new Map<string, { doctor: string; department: string; revenue: number; visits: number }>();
  for (const i of docInvoices as DocInv[]) {
    const doc = i.appointment?.doctor ?? i.admission?.doctor;
    if (!doc) continue;
    const key = `${doc.name}|${doc.department}`;
    const cur = docMap.get(key) ?? { doctor: doc.name, department: doc.department, revenue: 0, visits: 0 };
    cur.revenue = r2(cur.revenue + num(i.totalAmount)); cur.visits += 1;
    docMap.set(key, cur);
  }
  const revenueByDoctor = [...docMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    .map((d) => ({ doctor: d.doctor, department: d.department, revenue: d.revenue.toFixed(2), visits: d.visits }));

  // pharmacy profit (realized today + margin sitting in stock)
  const pharmacyProfit = await pharmacyProfitSummary();

  // hospital-wide collections today, split by payment type
  const collections = await collectionByMode();

  return {
    today: { appointments: apptsToday, completed: completedToday, newPatients: newPatientsToday, revenue: revToday.toFixed(2), labTests: labTestsToday },
    totals: { patients: totalPatients, doctors: totalDoctors, staff: totalStaff, invoices: totalInvoices },
    revenueToday: revToday.toFixed(2), revenueMtd: revMtd.toFixed(2), revenueYtd: revYtd.toFixed(2),
    bedOccupancy: { total: totalBeds, occupied: occupiedBeds, free: Math.max(0, totalBeds - occupiedBeds) },
    pharmacyAlerts,
    revenueBySource: [...bySource.entries()].map(([source, total]) => ({ source, total: total.toFixed(2) })),
    revenueByDoctor,
    pharmacyProfit,
    collectionsByMode: collections.modes,
    last7Days: series.slice(-7),
    last14Days: series,
    revenueLastMonthToDate: revLastMonthToDate.toFixed(2),
    last6Months: months,
    todayAppointments,
    recentBills,
    outstanding: outstanding.toFixed(2),
  };
}

// ---- Staff management ----
export interface StaffDTO {
  id: string; username: string; name: string; email: string | null; phone: string;
  role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string;
}

export async function listStaff(): Promise<StaffDTO[]> {
  const rows = await prisma.user.findMany({
    where: { role: { not: "PATIENT" } },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
    select: { id: true, username: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
  return rows.map((u: { id: string; username: string; name: string; email: string | null; phone: string; role: string; isActive: boolean; lastLoginAt: Date | null; createdAt: Date }) => ({
    id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone,
    role: u.role, isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));
}

/** Create a staff account. Username must be role.name (enforced by validator). */
export async function createStaff(
  actor: AuthUser,
  input: { username: string; name: string; email?: string; phone: string; role: string; password: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<StaffDTO> {
  const clash = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "That username, phone or email is already in use");

  const user = await prisma.user.create({
    data: {
      username: input.username,
      name: input.name,
      email: input.email || null,
      phone: input.phone,
      // validated upstream against the Role values; narrow for Prisma
      role: input.role as Role,
      passwordHash: await bcrypt.hash(input.password, 12),
      isActive: true,
    },
    select: { id: true, username: true, name: true, email: true, phone: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
  await logAudit(actor, { action: "STAFF_CREATED", targetTable: "User", targetId: user.id, meta: { username: input.username, role: input.role }, ...ctx });
  return { ...user, lastLoginAt: null, createdAt: user.createdAt.toISOString() };
}

/** Activate / deactivate a staff account. Never hard-deleted. */
export async function setStaffActive(
  actor: AuthUser,
  input: { userId: string; isActive: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true } });
  if (!u) throw new ApiError(404, "Staff member not found");
  if (u.id === actor.id) throw new ApiError(400, "You can't deactivate your own account");

  await prisma.user.update({ where: { id: input.userId }, data: { isActive: input.isActive } });
  await logAudit(actor, { action: input.isActive ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED", targetTable: "User", targetId: input.userId, ...ctx });
}

// ---- Lab catalog management (GST rates live here) ----
export async function upsertCatalogItem(
  actor: AuthUser,
  input: { id?: string; name: string; code?: string; price: number; gstRatePct: number; active: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  if (input.id) {
    await prisma.labTestCatalog.update({
      where: { id: input.id },
      data: { name: input.name, code: input.code || null, price: input.price.toFixed(2), gstRatePct: input.gstRatePct.toFixed(2), active: input.active },
    });
    await logAudit(actor, { action: "CATALOG_UPDATED", targetTable: "LabTestCatalog", targetId: input.id, meta: { gstRatePct: input.gstRatePct }, ...ctx });
  } else {
    const created = await prisma.labTestCatalog.create({
      data: { name: input.name, code: input.code || null, price: input.price.toFixed(2), gstRatePct: input.gstRatePct.toFixed(2), active: input.active },
      select: { id: true },
    });
    await logAudit(actor, { action: "CATALOG_CREATED", targetTable: "LabTestCatalog", targetId: created.id, ...ctx });
  }
}

export async function listAllCatalog(): Promise<{ id: string; name: string; code: string | null; price: string; gstRatePct: string; active: boolean }[]> {
  const rows = await prisma.labTestCatalog.findMany({ orderBy: { name: "asc" } });
  return rows.map((c: { id: string; name: string; code: string | null; price: { toString(): string }; gstRatePct: { toString(): string }; active: boolean }) => ({
    id: c.id, name: c.name, code: c.code, price: c.price.toString(), gstRatePct: c.gstRatePct.toString(), active: c.active,
  }));
}

// ---- Hospital config (GSTIN etc. on invoices) ----
export async function getHospitalConfig() {
  return prisma.hospitalConfig.findFirst();
}

/**
 * SETTINGS THAT EVERY PORTAL READS.
 *
 * Deliberately a separate, narrow query from getHospitalConfig(): this one is
 * called by the shell on every portal for every signed-in user, so it must not
 * drag the GSTIN and the address along for the ride, and it must never be the
 * thing that leaks a setting nobody outside admin should see.
 *
 * The fallbacks are the values that were hardcoded before this table had the
 * columns, so a hospital that has never opened the settings page gets exactly
 * what it had yesterday.
 */
export interface Branding {
  brandName: string;
  tagline: string | null;
  logoDataUrl: string | null;
  legalName: string | null;
}
export async function getBranding(): Promise<Branding> {
  const c = await prisma.hospitalConfig.findFirst({
    select: { brandName: true, tagline: true, logoDataUrl: true, legalName: true },
  });
  return {
    brandName: c?.brandName?.trim() || "Jeeva",
    tagline: c?.tagline?.trim() || null,
    logoDataUrl: c?.logoDataUrl || null,
    legalName: c?.legalName || null,
  };
}

/**
 * Operational settings the SERVER reads to decide how a portal behaves.
 *
 * Every caller gets a complete object with the old hardcoded value as the
 * fallback, so a missing config row can never turn a feature off. Failing safe
 * here means "behave the way you did before anyone touched settings", not
 * "assume the strictest option" - a hospital with no config row should still be
 * able to discharge patients.
 */
export interface OperationalSettings {
  expiryAlertDays: number;
  blockDischargeOnDues: boolean;
  onlineBookingEnabled: boolean;
  callbackRequestsEnabled: boolean;
  invoiceFooterNote: string | null;
}
export async function getSettings(): Promise<OperationalSettings> {
  const c = await prisma.hospitalConfig.findFirst({
    select: {
      expiryAlertDays: true, blockDischargeOnDues: true,
      onlineBookingEnabled: true, callbackRequestsEnabled: true, invoiceFooterNote: true,
    },
  });
  return {
    expiryAlertDays: c?.expiryAlertDays ?? 90,
    blockDischargeOnDues: c?.blockDischargeOnDues ?? true,
    onlineBookingEnabled: c?.onlineBookingEnabled ?? true,
    callbackRequestsEnabled: c?.callbackRequestsEnabled ?? true,
    invoiceFooterNote: c?.invoiceFooterNote?.trim() || null,
  };
}

/**
 * Nav rows the admin console should leave out, read server-side by the admin
 * layout so the sidebar is right on the first paint.
 *
 * Its own narrow query rather than a field on getSettings(): this runs on every
 * admin page render, and it has no business loading the invoice footer note to
 * decide whether to draw one link.
 *
 * Fails OPEN. If the config row is missing we show everything, because a
 * hospital with no settings row should see the console it had yesterday - a
 * missing row must never be the reason a feature disappears.
 */
export async function getHiddenAdminNavHrefs(): Promise<string[]> {
  const c = await prisma.hospitalConfig.findFirst({ select: { accountsTabEnabled: true } });
  return c?.accountsTabEnabled === false ? ["/accounts"] : [];
}

export async function updateHospitalConfig(
  actor: AuthUser,
  input: {
    legalName: string; addressLine: string; city: string; state: string;
    stateCode: string; pincode: string; gstin?: string; phone?: string; email?: string;
    logoDataUrl?: string; faviconDataUrl?: string; brandName?: string; tagline?: string;
    invoiceFooterNote?: string;
    expiryAlertDays?: number; blockDischargeOnDues?: boolean;
    onlineBookingEnabled?: boolean; callbackRequestsEnabled?: boolean;
    accountsTabEnabled?: boolean;
  },
  ctx: { ipAddress?: string; userAgent?: string }
) {
  const existing = await prisma.hospitalConfig.findFirst({
    select: {
      id: true, logoDataUrl: true, faviconDataUrl: true, blockDischargeOnDues: true,
      onlineBookingEnabled: true, callbackRequestsEnabled: true, expiryAlertDays: true,
      accountsTabEnabled: true,
    },
  });

  const { logoDataUrl, faviconDataUrl, tagline, invoiceFooterNote, ...rest } = input;
  const data = {
    ...rest,
    gstin: input.gstin || null,
    phone: input.phone || null,
    email: input.email || null,
    tagline: tagline?.trim() || null,
    invoiceFooterNote: invoiceFooterNote?.trim() || null,
    // Absent = leave the current logo alone. Empty string = the admin pressed
    // Remove. Those are different intentions and a spread would collapse them.
    ...(logoDataUrl === undefined ? {} : { logoDataUrl: logoDataUrl === "" ? null : logoDataUrl }),
    ...(faviconDataUrl === undefined ? {} : { faviconDataUrl: faviconDataUrl === "" ? null : faviconDataUrl }),
  };

  const saved = existing
    ? await prisma.hospitalConfig.update({ where: { id: existing.id }, data })
    : await prisma.hospitalConfig.create({ data });

  // A switch that changes how a whole portal behaves is worth naming in the audit
  // log, not folding into a generic "settings were updated". Six months from now
  // "why did discharges stop being blocked" needs an answer with a name on it.
  const changes: Record<string, string> = {};
  if (existing) {
    if (input.blockDischargeOnDues !== undefined && input.blockDischargeOnDues !== existing.blockDischargeOnDues) {
      changes.blockDischargeOnDues = `${existing.blockDischargeOnDues} -> ${input.blockDischargeOnDues}`;
    }
    if (input.onlineBookingEnabled !== undefined && input.onlineBookingEnabled !== existing.onlineBookingEnabled) {
      changes.onlineBookingEnabled = `${existing.onlineBookingEnabled} -> ${input.onlineBookingEnabled}`;
    }
    if (input.callbackRequestsEnabled !== undefined && input.callbackRequestsEnabled !== existing.callbackRequestsEnabled) {
      changes.callbackRequestsEnabled = `${existing.callbackRequestsEnabled} -> ${input.callbackRequestsEnabled}`;
    }
    if (input.expiryAlertDays !== undefined && input.expiryAlertDays !== existing.expiryAlertDays) {
      changes.expiryAlertDays = `${existing.expiryAlertDays} -> ${input.expiryAlertDays}`;
    }
    if (input.accountsTabEnabled !== undefined && input.accountsTabEnabled !== existing.accountsTabEnabled) {
      changes.accountsTabEnabled = `${existing.accountsTabEnabled} -> ${input.accountsTabEnabled}`;
    }
    if (logoDataUrl !== undefined && (logoDataUrl || null) !== (existing.logoDataUrl || null)) {
      changes.logo = logoDataUrl ? "replaced" : "removed";
    }
    if (faviconDataUrl !== undefined && (faviconDataUrl || null) !== (existing.faviconDataUrl || null)) {
      changes.favicon = faviconDataUrl ? "replaced" : "removed";
    }
  }

  await logAudit(actor, {
    action: "HOSPITAL_CONFIG_UPDATED", targetTable: "HospitalConfig", targetId: saved.id,
    ...(Object.keys(changes).length ? { meta: changes } : {}),
    ...ctx,
  });
  return saved;
}

// ---- Audit log ----
export async function listAuditLog(limit = 100): Promise<{
  id: string; action: string; targetTable: string; createdAt: string;
  actor: { name: string; role: string } | null;
}[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" }, take: limit,
    select: {
      id: true, action: true, targetTable: true, createdAt: true,
      actorUser: { select: { name: true, role: true } },
      actorPatient: { select: { fullName: true } },
    },
  });
  return rows.map((a: {
    id: string; action: string; targetTable: string; createdAt: Date;
    actorUser: { name: string; role: string } | null;
    actorPatient: { fullName: string } | null;
  }) => ({
    id: a.id, action: a.action, targetTable: a.targetTable,
    createdAt: a.createdAt.toISOString(),
    actor: a.actorUser
      ? { name: a.actorUser.name, role: a.actorUser.role }
      : a.actorPatient
        ? { name: a.actorPatient.fullName, role: "PATIENT" }
        : null,
  }));
}
