import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { localDateISO, dateOnlyISO } from "@/lib/date";
import { logAudit } from "./audit.service";
import { DUTY_DOCTOR } from "./appointments.service";
import { collectionByMode, type ModeTotal } from "./reports.service";
import { pharmacyProfitSummary } from "./pharmacy.service";
import { generateSlots, SLOT_HORIZON_DAYS } from "./slots.service";
import bcrypt from "bcryptjs";
import type { Role, Prisma } from "@prisma/client";
import type { AuthUser } from "@/lib/auth/types";
import type { DoctorProfileInput } from "@/server/validators/admin";
import { priceChanges, duplicateId } from "@/lib/lab-price";
import {
  buildAuditWhere, clampLimit, clampOffset, type AuditQuery,
} from "@/lib/audit-query";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The consulting diary a newly created doctor gets: round the clock, seven days,
 * 15-minute cadence. It matches what the hospital advertises on every consultant
 * panel ("Open 24 Hours"); reception re-cuts it to 10 minutes from the booking
 * screen when the desk wants finer granularity.
 */
const DIARY_START = "00:00";
const DIARY_END = "24:00";
const DIARY_SLOT_MIN = 15;

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

/** The consulting-profile half of a DOCTOR account. Null for every other role. */
export interface StaffDoctorDTO {
  id: string;
  specialization: string;
  department: string;
  consultationFee: string;
  qualification: string | null;
  experienceYears: number | null;
  age: number | null;
  languages: string | null;
  photoUrl: string | null;
  bio: string | null;
  active: boolean;
}

export interface StaffDTO {
  id: string; username: string; name: string; email: string | null; phone: string;
  role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string;
  doctor: StaffDoctorDTO | null;
}

/** What every read of a staff row selects, so the DTO can't drift between them. */
const STAFF_SELECT = {
  id: true, username: true, name: true, email: true, phone: true, role: true,
  isActive: true, lastLoginAt: true, createdAt: true,
  doctorProfile: {
    select: {
      id: true, specialization: true, department: true, consultationFee: true,
      qualification: true, experienceYears: true, age: true, languages: true,
      photoUrl: true, bio: true, active: true,
    },
  },
} as const;

type StaffRow = {
  id: string; username: string; name: string; email: string | null; phone: string;
  role: string; isActive: boolean; lastLoginAt: Date | null; createdAt: Date;
  doctorProfile: {
    id: string; specialization: string; department: string; consultationFee: { toString(): string };
    qualification: string | null; experienceYears: number | null; age: number | null;
    languages: string | null; photoUrl: string | null; bio: string | null; active: boolean;
  } | null;
};

function toStaffDTO(u: StaffRow): StaffDTO {
  return {
    id: u.id, username: u.username, name: u.name, email: u.email, phone: u.phone,
    role: u.role, isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
    doctor: u.doctorProfile
      ? { ...u.doctorProfile, consultationFee: u.doctorProfile.consultationFee.toString() }
      : null,
  };
}

export async function listStaff(): Promise<StaffDTO[]> {
  const rows = await prisma.user.findMany({
    where: { role: { not: "PATIENT" } },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
    select: STAFF_SELECT,
  });
  return (rows as StaffRow[]).map(toStaffDTO);
}

/**
 * Create a staff account. Username must be role.name (enforced by validator).
 *
 * For role DOCTOR this writes THREE things in one transaction - the login, the
 * consulting profile the public directory renders, and a round-the-clock diary
 * template. All three or none: a User with no Doctor row is a login that 404s
 * every clinical screen, and a Doctor with no schedule is a consultant the
 * booking grid shows as permanently full.
 *
 * The bookable slots are generated AFTER the transaction commits. That is tens
 * of thousands of rows across the horizon, and holding a transaction open for
 * it would block the whole table; a doctor with a diary but no slots yet is a
 * recoverable state (reception's "Regenerate" rebuilds them), an aborted
 * half-created doctor is not.
 */
export async function createStaff(
  actor: AuthUser,
  input: {
    username: string; name: string; email?: string; phone: string; role: string; password: string;
    doctor?: DoctorProfileInput;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<StaffDTO> {
  const clash = await prisma.user.findFirst({
    where: { OR: [{ username: input.username }, { phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "That username, phone or email is already in use");

  const isDoctor = input.role === "DOCTOR";
  const passwordHash = await bcrypt.hash(input.password, 12);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: input.username,
        name: input.name,
        email: input.email || null,
        phone: input.phone,
        // validated upstream against the Role values; narrow for Prisma
        role: input.role as Role,
        passwordHash,
        isActive: true,
      },
      select: { id: true },
    });

    if (isDoctor && input.doctor) {
      const doctor = await tx.doctor.create({
        data: { userId: user.id, name: input.name, ...doctorCreateData(input.doctor) },
        select: { id: true },
      });
      // 00:00-24:00, all seven days, 15-minute cadence - the same diary the
      // hospital advertises ("Open 24 Hours") on every consultant panel.
      // Reception can re-cut it to 10 minutes from the booking screen.
      await tx.doctorSchedule.createMany({
        data: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          doctorId: doctor.id, dayOfWeek,
          startTime: DIARY_START, endTime: DIARY_END, slotDurationMin: DIARY_SLOT_MIN,
        })),
      });
      return { userId: user.id, doctorId: doctor.id };
    }
    return { userId: user.id, doctorId: null as string | null };
  });

  if (created.doctorId) {
    try {
      await generateSlots(SLOT_HORIZON_DAYS, created.doctorId);
    } catch (e) {
      // The doctor exists and is correct; only the grid is missing. Say so in
      // the log rather than failing a request that already succeeded.
      console.error("[admin] doctor created but slot generation failed:", e);
    }
  }

  await logAudit(actor, { action: "STAFF_CREATED", targetTable: "User", targetId: created.userId, meta: { username: input.username, role: input.role }, ...ctx });

  const row = await prisma.user.findUniqueOrThrow({ where: { id: created.userId }, select: STAFF_SELECT });
  return toStaffDTO(row as StaffRow);
}

/**
 * Edit an existing staff account, and the consulting profile if it has one.
 *
 * Role is not editable - see the note on updateStaffSchema. An empty password
 * means "leave it alone", not "clear it": a User with a null passwordHash can
 * only get in by OTP, which is a silent lockout for anyone who signs in by
 * password.
 */
export async function updateStaff(
  actor: AuthUser,
  userId: string,
  input: {
    name?: string; email?: string; phone?: string; password?: string; isActive?: boolean;
    doctor?: Partial<DoctorProfileInput>;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<StaffDTO> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, doctorProfile: { select: { id: true } } },
  });
  if (!existing) throw new ApiError(404, "Staff member not found");
  if (existing.role === "PATIENT") throw new ApiError(400, "That is a patient account, not staff");
  if (existing.id === actor.id && input.isActive === false) {
    throw new ApiError(400, "You can't deactivate your own account");
  }

  // Uniqueness is enforced by the database too, but catching it here turns a
  // raw P2002 into a message that names the field.
  if (input.phone || input.email) {
    const clash = await prisma.user.findFirst({
      where: {
        id: { not: userId },
        OR: [...(input.phone ? [{ phone: input.phone }] : []), ...(input.email ? [{ email: input.email }] : [])],
      },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, "That phone or email is already in use");
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email || null;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password) data.passwordHash = await bcrypt.hash(input.password, 12);

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: userId }, data });
    }
    if (existing.doctorProfile && input.doctor) {
      await tx.doctor.update({
        where: { id: existing.doctorProfile.id },
        data: {
          // The display name follows the account name, so a renamed doctor does
          // not keep the old one on their public card.
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...doctorProfileData(input.doctor),
          // A disabled login must not stay bookable on the public site.
          ...(input.isActive !== undefined ? { active: input.isActive } : {}),
        },
      });
    } else if (existing.doctorProfile && input.isActive !== undefined) {
      await tx.doctor.update({
        where: { id: existing.doctorProfile.id },
        data: { active: input.isActive, ...(input.name !== undefined ? { name: input.name } : {}) },
      });
    }
  });

  await logAudit(actor, {
    action: "STAFF_UPDATED", targetTable: "User", targetId: userId,
    meta: { fields: Object.keys(data), passwordChanged: Boolean(input.password), doctorProfile: Boolean(input.doctor) },
    ...ctx,
  });

  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: STAFF_SELECT });
  return toStaffDTO(row as StaffRow);
}

export interface DeleteStaffResult {
  /** "deleted" = the row is gone. "deactivated" = it had history and was retired instead. */
  outcome: "deleted" | "deactivated";
  message: string;
}

/**
 * Postgres foreign-key violation, surfaced by Prisma as P2003.
 *
 * This is the signal that an account is still referenced somewhere. Deciding by
 * COUNTING the tables that reference User instead would need all twenty-odd of
 * them listed here and kept in step with the schema forever - and the first one
 * anybody forgot would send a delete into a raw constraint error, which reaches
 * the admin as "Internal server error". The database already knows the answer
 * exactly; asking it is both shorter and correct as the schema grows.
 */
function isForeignKeyViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2003";
}

/**
 * Remove a staff account.
 *
 * Deletes outright when nothing references it - a username mistyped on the day
 * it was created, which is the case an admin actually wants gone.
 *
 * When something DOES reference it, the delete is refused by the database, and
 * the account is deactivated instead. That is not a workaround for the foreign
 * keys; it is the point of them. An invoice records who took the money and a lab
 * report records who ran it, and those names are what an audit or a dispute is
 * settled with. Deleting the user would either destroy that evidence or leave a
 * bill signed by nobody.
 */
export async function deleteStaff(
  actor: AuthUser,
  userId: string,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<DeleteStaffResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, username: true, doctorProfile: { select: { id: true } } },
  });
  if (!user) throw new ApiError(404, "Staff member not found");
  if (user.id === actor.id) throw new ApiError(400, "You can't delete your own account");

  if (user.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
    if (otherAdmins === 0) throw new ApiError(400, "This is the last active admin - deleting it would lock everyone out");
  }

  const doctorId = user.doctorProfile?.id ?? null;

  // ---- The one reference the foreign keys will NOT defend -------------------
  // Appointment.doctorId is nullable (an emergency gets its OP number before
  // anyone knows who will see the patient), so Prisma's action for it is SetNull,
  // not Restrict. Deleting a doctor would therefore SUCCEED and quietly re-file
  // every visit they ever did as having no consultant - the printed sheet falls
  // back to the duty-doctor signature block, and the visit history is gone with
  // no error anywhere. Prescriptions and admissions are required relations and do
  // refuse; appointments have to be checked here.
  const orphanableVisits = doctorId
    ? await prisma.appointment.count({ where: { doctorId } })
    : 0;

  // ---- Try the real delete -------------------------------------------------
  // Everything cleared inside belongs to the account alone - its login trail and,
  // for a doctor, an empty diary. Anything CLINICAL that points here is left for
  // the foreign keys to object to, which is what routes us to the branch below.
  // The whole thing is one transaction, so a refusal at the last statement rolls
  // back the rest and the account is untouched.
  //
  // Callback requests are deliberately NOT deleted: their doctorId is nullable
  // because "any available doctor" is a real answer, so SetNull leaves the
  // enquiry in reception's queue instead of dropping a patient waiting for a call.
  if (orphanableVisits === 0) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.staffSession.deleteMany({ where: { userId } });
        await tx.otp.deleteMany({ where: { userId } });
        await tx.auditLog.deleteMany({ where: { actorUserId: userId } });
        if (doctorId) {
          await tx.doctorSlot.deleteMany({ where: { doctorId } });
          await tx.doctorSchedule.deleteMany({ where: { doctorId } });
          await tx.doctor.delete({ where: { id: doctorId } });
        }
        await tx.user.delete({ where: { id: userId } });
      });

      // Logged against the actor - the target row no longer exists to point at.
      await logAudit(actor, { action: "STAFF_DELETED", targetTable: "User", targetId: userId, meta: { username: user.username, name: user.name, role: user.role }, ...ctx });
      return { outcome: "deleted", message: `${user.name} was deleted. They had no clinical or financial records.` };
    } catch (e) {
      if (!isForeignKeyViolation(e)) throw e;
    }
  }

  // ---- Referenced somewhere: retire the account instead ---------------------
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } });
    // A disabled doctor must also drop off the public directory and the booking
    // grid, which read Doctor.active - not User.isActive.
    if (doctorId) await tx.doctor.update({ where: { id: doctorId }, data: { active: false } });
    // Revoke the way back in - a disabled account holding a live refresh token
    // keeps working until that token expires.
    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.staffSession.deleteMany({ where: { userId } });
  });

  // Counted only now, and only to write a message that names what is holding the
  // account. Not exhaustive, and it does not need to be: the decision was already
  // made by the database. If none of these match, the generic sentence is used.
  const [invoices, payments, labTests, appointments, admissions, prescriptions, stock] =
    await Promise.all([
      prisma.invoice.count({ where: { createdById: userId } }),
      prisma.payment.count({ where: { receivedById: userId } }),
      prisma.labTest.count({ where: { technicianId: userId } }),
      prisma.appointment.count({ where: { createdById: userId } }),
      doctorId ? prisma.admission.count({ where: { doctorId } }) : Promise.resolve(0),
      doctorId ? prisma.prescription.count({ where: { doctorId } }) : Promise.resolve(0),
      prisma.stockTransaction.count({ where: { performedById: userId } }),
    ]);

  const parts = [
    appointments && `${appointments} appointment(s) booked`,
    orphanableVisits && `${orphanableVisits} appointment(s) as the consultant`,
    invoices && `${invoices} invoice(s)`,
    payments && `${payments} payment(s)`,
    labTests && `${labTests} lab test(s)`,
    prescriptions && `${prescriptions} prescription(s)`,
    admissions && `${admissions} admission(s)`,
    stock && `${stock} stock movement(s)`,
  ].filter(Boolean).join(", ");

  await logAudit(actor, { action: "STAFF_DEACTIVATED", targetTable: "User", targetId: userId, meta: { reason: "referenced by clinical or financial records", parts }, ...ctx });

  return {
    outcome: "deactivated",
    message: parts
      ? `${user.name} has ${parts} on record, so the account was disabled rather than deleted. Those records stay signed by them, and they can no longer sign in.`
      : `${user.name} is referenced by records that must keep their author, so the account was disabled rather than deleted. They can no longer sign in.`,
  };
}

/** Activate / deactivate a staff account. Never hard-deleted. */
export async function setStaffActive(
  actor: AuthUser,
  input: { userId: string; isActive: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const u = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, doctorProfile: { select: { id: true } } },
  });
  if (!u) throw new ApiError(404, "Staff member not found");
  if (u.id === actor.id) throw new ApiError(400, "You can't deactivate your own account");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { isActive: input.isActive } });
    // A disabled doctor must also drop off the public directory and the booking
    // grid, which read Doctor.active - not User.isActive.
    if (u.doctorProfile) {
      await tx.doctor.update({ where: { id: u.doctorProfile.id }, data: { active: input.isActive } });
    }
    if (!input.isActive) {
      await tx.refreshToken.deleteMany({ where: { userId: input.userId } });
      await tx.staffSession.deleteMany({ where: { userId: input.userId } });
    }
  });
  await logAudit(actor, { action: input.isActive ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED", targetTable: "User", targetId: input.userId, ...ctx });
}

/**
 * Maps validated profile input onto Doctor columns, dropping anything the form
 * didn't send. Empty strings become null so a cleared field reads as absent
 * rather than as an empty line on a printed card.
 *
 * Plain column values, not Prisma's update-input shape: the result is spread
 * into both a `create` and an `update`, and DoctorUpdateInput additionally
 * permits `{ set: … }` wrappers that a create won't take.
 */
type DoctorProfileColumns = {
  specialization?: string;
  department?: string;
  consultationFee?: string;
  qualification?: string | null;
  experienceYears?: number | null;
  age?: number | null;
  languages?: string | null;
  photoUrl?: string | null;
  bio?: string | null;
};

function doctorProfileData(d: Partial<DoctorProfileInput>): DoctorProfileColumns {
  const out: DoctorProfileColumns = {};
  if (d.specialization !== undefined) out.specialization = d.specialization;
  if (d.department !== undefined) out.department = d.department;
  if (d.consultationFee !== undefined) out.consultationFee = d.consultationFee.toFixed(2);
  if (d.qualification !== undefined) out.qualification = d.qualification || null;
  if (d.experienceYears !== undefined) out.experienceYears = d.experienceYears ?? null;
  if (d.age !== undefined) out.age = d.age ?? null;
  if (d.languages !== undefined) out.languages = d.languages || null;
  if (d.photoUrl !== undefined) out.photoUrl = d.photoUrl || null;
  if (d.bio !== undefined) out.bio = d.bio || null;
  return out;
}

/**
 * Same mapping for a NEW doctor, with the three columns the schema requires
 * pinned as present. The validator already guarantees them on the create path;
 * restating them here is what lets the compiler agree.
 */
function doctorCreateData(d: DoctorProfileInput): DoctorProfileColumns &
  { specialization: string; department: string; consultationFee: string } {
  return {
    ...doctorProfileData(d),
    specialization: d.specialization,
    department: d.department,
    consultationFee: d.consultationFee.toFixed(2),
  };
}

// ---- Lab catalog management (GST rates live here) ----
/**
 * Create or update a test in the ONE catalogue.
 *
 * TWO SCREENS, ONE WRITE PATH. Admin -> Lab catalog & GST and Labs -> Test
 * catalog both land here. There is no syncing between them and nothing to keep
 * in step, because there is only ever one row: the lab technician who corrects a
 * price and the admin who reads it are looking at the same record through two
 * doors. Anything that made a second path - a labs-only table, a copy, a
 * queue - would be a way for the two screens to disagree, and the price they
 * would disagree about is the one a patient gets billed.
 *
 * `gstRatePct` IS OPTIONAL, and that is the difference between the two doors.
 * A tax rate is a CA's call, not a bench call, so the labs screen never sends
 * one: on an update the column is left exactly as the admin set it, and on a
 * create it starts at 0 - exempt, which is what a diagnostic service is under
 * Notification 12/2017. Omitting it is not the same as sending 0; the first
 * preserves a rate somebody decided on, the second overwrites it.
 */
export async function upsertCatalogItem(
  actor: AuthUser,
  input: { id?: string; name: string; code?: string; price: number; gstRatePct?: number; active: boolean },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const gst = input.gstRatePct == null ? {} : { gstRatePct: input.gstRatePct.toFixed(2) };
  if (input.id) {
    await prisma.labTestCatalog.update({
      where: { id: input.id },
      data: { name: input.name, code: input.code || null, price: input.price.toFixed(2), ...gst, active: input.active },
    });
    await logAudit(actor, { action: "CATALOG_UPDATED", targetTable: "LabTestCatalog", targetId: input.id, meta: { gstRatePct: input.gstRatePct ?? null }, ...ctx });
  } else {
    const created = await prisma.labTestCatalog.create({
      data: {
        name: input.name, code: input.code || null, price: input.price.toFixed(2),
        gstRatePct: (input.gstRatePct ?? 0).toFixed(2), active: input.active,
      },
      select: { id: true },
    });
    await logAudit(actor, { action: "CATALOG_CREATED", targetTable: "LabTestCatalog", targetId: created.id, ...ctx });
  }
}

/**
 * CORRECT MANY PRICES IN ONE SUBMIT.
 *
 * The catalogue was seeded from the lab's own report forms, and a report form
 * carries no rate - so every test the seed could not carry a price over for
 * landed at ₹0. A test at ₹0 is not obviously broken on any screen: it orders,
 * it bills, it prints, and the patient is charged nothing for it. There were
 * forty of them, and fixing forty through a modal that reloads the whole
 * catalogue between each one is how the last five never get done.
 *
 * WHY THIS IS NOT A LOOP OVER upsertCatalogItem. That function writes the name,
 * the code and the active flag as well, so driving it from a price grid would
 * mean the grid holding - and re-asserting - four fields it does not show. A row
 * the technician never touched would be rewritten with whatever the browser
 * happened to be told about it when the page loaded, which is how a rename made
 * on the catalogue screen in another tab gets silently reverted by someone
 * fixing an unrelated price. This touches ONE column.
 *
 * UNCHANGED PRICES ARE NOT WRITTEN. The grid posts every row it is holding, but
 * only the ones that actually moved reach the database. Otherwise opening the
 * screen and pressing Save would stamp sixty rows and bury the audit log under
 * corrections nobody made.
 *
 * IT DOES NOT TOUCH TESTS ALREADY ORDERED. `LabTest.priceAtOrder` is a snapshot
 * taken when the sample was raised, on purpose - a bill already handed to a
 * patient must not change because somebody edited the menu afterwards. So this
 * fixes what gets billed from now on, and the zero-rated tests already sitting
 * in the queue stay zero. Those have to be corrected on the bill itself.
 */
export async function bulkUpdateCatalogPrices(
  actor: AuthUser,
  items: { id: string; price: number }[],
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ updated: number }> {
  const ids = items.map((i) => i.id);
  if (duplicateId(ids)) throw new ApiError(400, "The same test was sent twice");

  const existing = await prisma.labTestCatalog.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, price: true },
  });
  if (existing.length !== ids.length) {
    throw new ApiError(400, "One of these tests no longer exists - reload the page");
  }

  const changed = priceChanges(
    existing.map((e) => ({ id: e.id, name: e.name, price: e.price.toString() })),
    items,
  );
  if (!changed.length) return { updated: 0 };

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const c of changed) {
      await tx.labTestCatalog.update({
        where: { id: c.id },
        data: { price: c.to.toFixed(2) },
      });
    }
    // ONE entry for the submit, not one per row. A price correction round is a
    // single decision by a single person; forty rows in the log describing it
    // would push everything else off the first page of the audit screen. The
    // before-and-after of every test is in the meta, which is where somebody
    // asking "who dropped the CBP to 50" actually looks.
    await logAudit(actor, {
      action: "CATALOG_PRICES_UPDATED",
      targetTable: "LabTestCatalog",
      targetId: changed[0].id,
      meta: {
        count: changed.length,
        changes: changed.map((c) => ({ id: c.id, name: c.name, from: c.from, to: c.to })),
      },
      ...ctx,
    }, tx);
  });

  return { updated: changed.length };
}

export interface CatalogAnalyteDTO {
  name: string; unit: string | null;
  refLow: string | null; refHigh: string | null; refText: string | null;
}

/** The normal-value template for one test, in the order it prints. */
export async function listCatalogAnalytes(catalogId: string): Promise<CatalogAnalyteDTO[]> {
  const rows = await prisma.labAnalyte.findMany({
    where: { catalogId },
    orderBy: { sortOrder: "asc" },
    select: { name: true, unit: true, refLow: true, refHigh: true, refText: true },
  });
  return rows.map((a) => ({
    name: a.name,
    unit: a.unit,
    refLow: a.refLow == null ? null : a.refLow.toString(),
    refHigh: a.refHigh == null ? null : a.refHigh.toString(),
    refText: a.refText,
  }));
}

/**
 * Replace a test's normal values wholesale.
 *
 * REPLACE, NOT MERGE - the same rule the catalogue seed follows, and for the
 * same reason: these rows are a TEMPLATE for the results form, so a row the
 * technician deleted has been deleted from the form and must not linger. Merging
 * would make deletion impossible to express.
 *
 * WHAT THIS DOES NOT TOUCH is any result already reported. A LabResultItem
 * carries its own copy of the name, the unit and the range it was measured
 * against, snapshotted at save time - so changing the template here changes what
 * the NEXT sample is judged by, and re-opening a report from March still prints
 * March's numbers against March's ranges. That separation is the whole reason
 * editing this is safe to hand to the bench.
 *
 * The whole set is written in one transaction: a delete that succeeded and a
 * create that failed would leave a test with no rows to fill in at all.
 */
export async function replaceCatalogAnalytes(
  actor: AuthUser,
  catalogId: string,
  rows: { name: string; unit?: string | null; refLow?: number | null; refHigh?: number | null; refText?: string | null }[],
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const exists = await prisma.labTestCatalog.findUnique({ where: { id: catalogId }, select: { id: true } });
  if (!exists) throw new ApiError(404, "That test is not in the catalog");

  await prisma.$transaction(async (tx) => {
    await tx.labAnalyte.deleteMany({ where: { catalogId } });
    if (rows.length) {
      await tx.labAnalyte.createMany({
        data: rows.map((a, i) => ({
          catalogId,
          name: a.name,
          unit: a.unit?.trim() || null,
          refLow: a.refLow == null ? null : a.refLow.toFixed(4),
          refHigh: a.refHigh == null ? null : a.refHigh.toFixed(4),
          refText: a.refText?.trim() || null,
          sortOrder: i,
        })),
      });
    }
  });

  await logAudit(actor, {
    action: "CATALOG_ANALYTES_REPLACED",
    targetTable: "LabTestCatalog",
    targetId: catalogId,
    meta: { count: rows.length },
    ...ctx,
  });
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
  /** Reception and the insurance desk may edit unpaid bills. Off by default -
   *  see the column comment in schema.prisma for why. */
  billEditingEnabled: boolean;
}
export async function getSettings(): Promise<OperationalSettings> {
  const c = await prisma.hospitalConfig.findFirst({
    select: {
      expiryAlertDays: true, blockDischargeOnDues: true,
      onlineBookingEnabled: true, callbackRequestsEnabled: true, invoiceFooterNote: true,
      billEditingEnabled: true,
    },
  });
  return {
    expiryAlertDays: c?.expiryAlertDays ?? 90,
    blockDischargeOnDues: c?.blockDischargeOnDues ?? true,
    onlineBookingEnabled: c?.onlineBookingEnabled ?? true,
    callbackRequestsEnabled: c?.callbackRequestsEnabled ?? true,
    invoiceFooterNote: c?.invoiceFooterNote?.trim() || null,
    // Fails CLOSED, unlike every other fallback here. A missing config row must
    // not be the reason a desk can rewrite a GST document.
    billEditingEnabled: c?.billEditingEnabled ?? false,
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
    billEditingEnabled?: boolean;
    afterHoursOpEnabled?: boolean; afterHoursOpStart?: string;
    afterHoursOpEnd?: string; afterHoursOpMultiplier?: number;
  },
  ctx: { ipAddress?: string; userAgent?: string }
) {
  const existing = await prisma.hospitalConfig.findFirst({
    select: {
      id: true, logoDataUrl: true, faviconDataUrl: true, blockDischargeOnDues: true,
      onlineBookingEnabled: true, callbackRequestsEnabled: true, expiryAlertDays: true,
      accountsTabEnabled: true, billEditingEnabled: true,
      afterHoursOpEnabled: true, afterHoursOpStart: true,
      afterHoursOpEnd: true, afterHoursOpMultiplier: true,
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
    // The one switch on this page that hands a desk the ability to rewrite a tax
    // document. "Who turned bill editing on, and when" is the first question
    // asked when a printed receipt stops matching the ledger.
    if (input.billEditingEnabled !== undefined && input.billEditingEnabled !== existing.billEditingEnabled) {
      changes.billEditingEnabled = `${existing.billEditingEnabled} -> ${input.billEditingEnabled}`;
    }
    // After-hours pricing changes what a patient is charged, so each part of it
    // is named individually. "The night rate went from 2x to 3x on the 14th, by
    // whom" is a question somebody will eventually have to answer.
    if (input.afterHoursOpEnabled !== undefined && input.afterHoursOpEnabled !== existing.afterHoursOpEnabled) {
      changes.afterHoursOpEnabled = `${existing.afterHoursOpEnabled} -> ${input.afterHoursOpEnabled}`;
    }
    if (input.afterHoursOpStart !== undefined && input.afterHoursOpStart !== existing.afterHoursOpStart) {
      changes.afterHoursOpStart = `${existing.afterHoursOpStart} -> ${input.afterHoursOpStart}`;
    }
    if (input.afterHoursOpEnd !== undefined && input.afterHoursOpEnd !== existing.afterHoursOpEnd) {
      changes.afterHoursOpEnd = `${existing.afterHoursOpEnd} -> ${input.afterHoursOpEnd}`;
    }
    if (input.afterHoursOpMultiplier !== undefined
        && input.afterHoursOpMultiplier !== Number(existing.afterHoursOpMultiplier)) {
      changes.afterHoursOpMultiplier = `${Number(existing.afterHoursOpMultiplier)}x -> ${input.afterHoursOpMultiplier}x`;
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

export interface AuditRow {
  id: string; action: string; targetTable: string; targetId: string; createdAt: string;
  actor: { name: string; role: string } | null;
  meta: unknown;
  ipAddress: string | null;
}

/**
 * Query the audit trail.
 *
 * WHAT CHANGED AND WHY. This took a row limit and nothing else: no actor, no
 * action, no target, no dates. It also dropped targetId, meta and the IP before
 * returning, so even the hundred rows it did show could not be tied to the record
 * they were about. The trail was being written and could not be read.
 *
 * The two questions it now answers are the two it exists for: "produce everything
 * recorded against this patient" (medico-legal) and "what did this member of staff
 * do that day" (money or medicines going missing).
 *
 * META IS RETURNED UNREDACTED, unlike ErrorLog. That is deliberate and it is the
 * opposite call from the error table. An error's message is incidental and may
 * leak a UHID by accident, so it is scrubbed. An audit row's meta is the evidence -
 * the ip number, the amount waived, the dues overridden - and a redacted audit
 * trail cannot support the decision it was kept for. It is ADMIN-only for exactly
 * this reason.
 *
 * `total` is returned alongside so the page can say "showing 100 of 4,318" rather
 * than leaving the reader to guess whether they are looking at everything.
 */
export async function listAuditLog(
  query: AuditQuery = {},
): Promise<{ logs: AuditRow[]; total: number; limit: number; offset: number }> {
  const where = buildAuditWhere(query) as Prisma.AuditLogWhereInput;
  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true, action: true, targetTable: true, targetId: true, createdAt: true,
        meta: true, ipAddress: true,
        actorUser: { select: { name: true, role: true } },
        actorPatient: { select: { fullName: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  type Row = {
    id: string; action: string; targetTable: string; targetId: string; createdAt: Date;
    meta: unknown; ipAddress: string | null;
    actorUser: { name: string; role: string } | null;
    actorPatient: { fullName: string } | null;
  };

  return {
    logs: (rows as Row[]).map((a) => ({
      id: a.id, action: a.action, targetTable: a.targetTable, targetId: a.targetId,
      createdAt: a.createdAt.toISOString(),
      meta: a.meta ?? null,
      ipAddress: a.ipAddress,
      actor: a.actorUser
        ? { name: a.actorUser.name, role: a.actorUser.role }
        // An anonymous action is recorded with no actor on purpose - see logAudit.
        : a.actorPatient
          ? { name: a.actorPatient.fullName, role: "PATIENT" }
          : null,
    })),
    total, limit, offset,
  };
}

/**
 * The distinct values present in the trail, for the filter dropdowns.
 *
 * Read from the data rather than from a hardcoded list, so an action added by
 * future code appears in the filter without anyone remembering to register it.
 */
export async function auditFilterOptions(): Promise<{ actions: string[]; tables: string[] }> {
  const [actions, tables] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["targetTable"], select: { targetTable: true }, orderBy: { targetTable: "asc" } }),
  ]);
  return {
    actions: actions.map((a: { action: string }) => a.action),
    tables: tables.map((t: { targetTable: string }) => t.targetTable),
  };
}
