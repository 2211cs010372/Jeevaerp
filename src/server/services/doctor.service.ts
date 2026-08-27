import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { DUTY_DOCTOR } from "./appointments.service";
import { abnormalCount, resultsForTests, type LabResultDTO } from "./labs.service";
import { publishLive } from "@/server/realtime/publish";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";
import type { AuthUser } from "@/lib/auth/types";

// ---------------------------------------------------------------------------
// The doctor writes prescriptions BY HAND on paper. So this portal is a
// clinical *reading* surface, not a writer: who's waiting, what's their
// history, what did the lab find, what did I prescribe last time (the scan).
// ---------------------------------------------------------------------------

/**
 * Slot times are stored as "HH:MM" 24h STRINGS (see DoctorSlot in the schema),
 * not Dates. Format for display without pretending otherwise.
 */
function to12h(hhmm: string): string {
  const [hStr, m] = hhmm.split(":");
  const h = Number(hStr);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m ?? "00"} ${suffix}`;
}

interface Doc { id: string; name: string; department: string }

/** Resolve the Doctor row for a signed-in doctor user. */
async function ownDoctor(actor: AuthUser): Promise<Doc> {
  const doc = await prisma.doctor.findUnique({
    where: { userId: actor.id },
    select: { id: true, name: true, department: true },
  });
  if (!doc) throw new ApiError(403, "This account isn't linked to a doctor profile");
  return doc;
}

/**
 * WHOSE day this portal is showing.
 *
 * A doctor sees their own, resolved from the Doctor row their login is attached
 * to. An ADMIN has no such row - admins are not consultants - and used to be
 * refused outright, which made the consulting room the one portal the access
 * model let them into and the app then locked them out of. They now choose a
 * doctor and READ that doctor's day; `null` means they have not chosen yet, and
 * the caller answers with the roster instead of a queue.
 *
 * Choosing is not a privilege escalation: an admin can already see every one of
 * these appointments, results and admissions in the admin console. What stays
 * out of reach is the WRITE - completeConsultation resolves the actor's own
 * doctor profile and so can only ever be the doctor themselves.
 */
async function doctorInView(actor: AuthUser, viewAsDoctorId?: string): Promise<Doc | null> {
  if (actor.role !== "ADMIN") return ownDoctor(actor);
  if (!viewAsDoctorId) return null;

  const doc = await prisma.doctor.findUnique({
    where: { id: viewAsDoctorId },
    select: { id: true, name: true, department: true },
  });
  if (!doc) throw new ApiError(404, "No doctor with that id");
  return doc;
}

/** The picker's options. Deliberately three columns, not the full DoctorDTO. */
async function roster(): Promise<Doc[]> {
  return prisma.doctor.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, department: true },
  });
}

export interface DoctorQueueItem {
  appointmentId: string; opNumber: string; time: string; status: string;
  patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string; bloodGroup: string | null };
}

/** A finished investigation on one of this doctor's patients, waiting to be read. */
export interface DoctorLabResult {
  id: string; testName: string; reportReady: boolean; reportUrl: string | null;
  completedAt: string; source: "OPD" | "IPD";
  patient: { displayId: string; fullName: string };
  /** The measured values, so the doctor reads the result without opening a file. */
  results: LabResultDTO[];
  /** Lines out of range - what decides whether this needs looking at first. */
  abnormal: number;
  /**
   * What the lab wrote about these numbers (LabTest.impression). Surfaced on
   * the doctor's own list because a bench note that only exists inside the labs
   * portal has not reached the person who acts on it.
   */
  impression: string | null;
}
/** One of this doctor's patients currently lying in a bed. */
export interface DoctorInpatient {
  admissionId: string; ipNumber: string; wardName: string; bedNo: string; days: number; admittedAt: string;
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null };
}

/** Today's clinic list for this doctor - the queue they work through, plus the
 *  two things a doctor otherwise has to go hunting for: results that have come
 *  back, and their own patients currently admitted upstairs. */
export async function doctorToday(actor: AuthUser, viewAsDoctorId?: string): Promise<{
  doctor: { id: string; name: string; department: string } | null;
  stats: { booked: number; checkedIn: number; completed: number; total: number };
  queue: DoctorQueueItem[];
  labResults: DoctorLabResult[];
  inpatients: DoctorInpatient[];
  /** Read-only viewer (an ADMIN). Absent for the doctor whose day this is. */
  readOnly?: true;
  /** The doctors an ADMIN may switch between. Absent for a doctor. */
  roster?: { id: string; name: string; department: string }[];
}> {
  const doc = await doctorInView(actor, viewAsDoctorId);
  const viewing = actor.role === "ADMIN" ? { readOnly: true as const, roster: await roster() } : {};

  // An admin who has not picked a doctor yet. Empty rather than an error: the
  // screen has a roster to render and nothing has gone wrong.
  if (!doc) {
    return {
      doctor: null,
      stats: { booked: 0, checkedIn: 0, completed: 0, total: 0 },
      queue: [], labResults: [], inpatients: [],
      ...viewing,
    };
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const appts = await prisma.appointment.findMany({
    where: { doctorId: doc.id, visitDate: today, status: { not: "CANCELLED" } },
    orderBy: { timeAtBooking: "asc" },
    select: {
      id: true, opNumber: true, status: true,
      timeAtBooking: true,
      patient: {
        select: { id: true, displayId: true, fullName: true, age: true, gender: true, phone: true, bloodGroup: true },
      },
    },
  });

  type Row = {
    id: string; opNumber: string; status: string;
    timeAtBooking: string; // "HH:MM" - a string, not a Date
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string; bloodGroup: string | null };
  };

  const queue = (appts as Row[]).map((a) => ({
    appointmentId: a.id,
    opNumber: a.opNumber,
    time: to12h(a.timeAtBooking),
    status: a.status,
    patient: a.patient,
  }));

  // ── Results back in the last fortnight, on this doctor's patients ──
  // A test belongs to this doctor through the visit that ordered it, or through
  // the stay they're admitted under.
  const since = new Date(Date.now() - 14 * 86400000);
  const labRows = await prisma.labTest.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: since },
      OR: [{ appointment: { doctorId: doc.id } }, { admission: { doctorId: doc.id } }],
    },
    orderBy: { completedAt: "desc" },
    take: 10,
    select: {
      id: true, testName: true, reportFileUrl: true, completedAt: true, admissionId: true, impression: true,
      patient: { select: { displayId: true, fullName: true } },
    },
  });
  type LabRow = {
    id: string; testName: string; reportFileUrl: string | null; completedAt: Date | null; admissionId: string | null;
    impression: string | null;
    patient: { displayId: string; fullName: string } | null;
  };
  // The numbers, not just a link to them. A doctor scanning the morning list
  // needs to see "Hb 8.1 LOW" on the row, not open ten PDFs to find the one
  // that matters.
  const labValues = await resultsForTests((labRows as LabRow[]).map((t) => t.id));

  const labResults: DoctorLabResult[] = (labRows as LabRow[])
    .filter((t) => t.patient)
    .map((t) => {
      const results = labValues[t.id] ?? [];
      return {
        id: t.id, testName: t.testName,
        reportReady: Boolean(t.reportFileUrl), reportUrl: t.reportFileUrl,
        completedAt: (t.completedAt ?? new Date()).toISOString(),
        source: (t.admissionId ? "IPD" : "OPD") as "OPD" | "IPD",
        patient: t.patient!,
        results,
        abnormal: abnormalCount(results),
        impression: t.impression,
      };
    });

  // ── This doctor's patients currently in a bed ──
  const admRows = await prisma.admission.findMany({
    where: { doctorId: doc.id, status: "ADMITTED" },
    orderBy: { admittedAt: "asc" },
    select: {
      id: true, ipNumber: true, admittedAt: true, wardNameAtAdmit: true,
      bed: { select: { bedNo: true } },
      patient: { select: { displayId: true, fullName: true, age: true, gender: true } },
    },
  });
  type AdmRow = {
    id: string; ipNumber: string; admittedAt: Date; wardNameAtAdmit: string;
    bed: { bedNo: string } | null;
    patient: { displayId: string; fullName: string; age: number | null; gender: string | null };
  };
  const now = Date.now();
  const inpatients: DoctorInpatient[] = (admRows as AdmRow[]).map((a) => ({
    admissionId: a.id, ipNumber: a.ipNumber,
    wardName: a.wardNameAtAdmit, bedNo: a.bed?.bedNo ?? "-",
    days: Math.max(1, Math.ceil((now - a.admittedAt.getTime()) / 86400000)),
    admittedAt: a.admittedAt.toISOString(),
    patient: a.patient,
  }));

  return {
    ...viewing,
    doctor: { id: doc.id, name: doc.name, department: doc.department },
    stats: {
      booked: queue.filter((q) => q.status === "BOOKED").length,
      checkedIn: queue.filter((q) => q.status === "CHECKED_IN").length,
      completed: queue.filter((q) => q.status === "COMPLETED").length,
      total: queue.length,
    },
    queue,
    labResults,
    inpatients,
  };
}

/** Mark a consultation finished - the one write a doctor makes here. */
export async function completeConsultation(actor: AuthUser, appointmentId: string): Promise<void> {
  // `ownDoctor`, never `doctorInView`. Closing a consultation is a clinical
  // assertion that the doctor saw the patient, so it can only be made by the
  // account the Doctor row belongs to - an admin reading the same queue has no
  // profile here and is refused, which is the intended answer.
  const doc = await ownDoctor(actor);
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, doctorId: true, status: true },
  });
  if (!appt) throw new ApiError(404, "Appointment not found");
  if (appt.doctorId !== doc.id) throw new ApiError(403, "That isn't your appointment");
  if (appt.status === "COMPLETED") throw new ApiError(400, "Already completed");

  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });

  // The desk is waiting on exactly this to close billing on the visit, and the
  // doctor's own queue has to drop the row without them refreshing it.
  await publishLive(
    [TOPICS.RECEPTION, TOPICS.DOCTOR, TOPICS.ADMIN],
    EVENTS.CONSULTATION_COMPLETED
  );
}

/**
 * Everything a doctor needs on one patient: history, lab results, and the
 * scans of the handwritten prescriptions from previous visits.
 */
export async function doctorPatientChart(actor: AuthUser, displayId: string) {
  // Any doctor may read any patient's chart; an ADMIN may too, and has no
  // Doctor row to check. The route's requireRole has already refused everyone
  // else, so this is the profile check, not the permission check.
  if (actor.role !== "ADMIN") await ownDoctor(actor);

  const patient = await prisma.patient.findUnique({
    where: { displayId },
    select: {
      id: true, displayId: true, fullName: true, age: true, dob: true, gender: true,
      bloodGroup: true, phone: true, address: true, city: true,
      occupation: true, remarks: true, isVip: true,
      mergedIntoId: true, deletedAt: true,
    },
  });
  if (!patient || patient.mergedIntoId || patient.deletedAt) throw new ApiError(404, "No patient found with that ID");

  const [visits, labs, scans] = await Promise.all([
    prisma.appointment.findMany({
      where: { patientId: patient.id },
      orderBy: { visitDate: "desc" }, take: 20,
      select: {
        opNumber: true, visitDate: true, status: true,
        doctor: { select: { name: true, department: true } },
      },
    }),
    prisma.labTest.findMany({
      where: { OR: [{ patientId: patient.id }, { appointment: { patientId: patient.id } }] },
      orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, testName: true, status: true, reportFileUrl: true, createdAt: true, completedAt: true },
    }),
    prisma.prescriptionUpload.findMany({
      where: { patientId: patient.id },
      orderBy: { createdAt: "desc" }, take: 20,
      select: {
        id: true, appointmentId: true, fileUrl: true, fileName: true, title: true, doctorName: true,
        status: true, createdAt: true,
        appointment: { select: { opNumber: true, visitDate: true, doctor: { select: { name: true } } } },
      },
    }),
  ]);

  // One query for every test on the chart - see resultsForTests. A chart
  // showing thirty investigations must not cost thirty round trips.
  const labValues = await resultsForTests(
    (labs as { id: string }[]).map((l) => l.id)
  );

  return {
    patient: {
      id: patient.id, displayId: patient.displayId, fullName: patient.fullName,
      age: patient.age, gender: patient.gender, bloodGroup: patient.bloodGroup,
      phone: patient.phone, address: patient.address, city: patient.city,
      occupation: patient.occupation, remarks: patient.remarks, isVip: patient.isVip,
    },
    visits: (visits as { opNumber: string; visitDate: Date; status: string; doctor: { name: string; department: string } | null }[]).map((v) => ({
      opNumber: v.opNumber,
      visitDate: v.visitDate.toISOString().slice(0, 10),
      status: v.status,
      // An emergency visit has no consultant on record - see Appointment.doctorId.
      doctorName: v.doctor?.name ?? DUTY_DOCTOR.name,
      department: v.doctor?.department ?? DUTY_DOCTOR.department,
    })),
    labs: (labs as { id: string; testName: string; status: string; reportFileUrl: string | null; createdAt: Date; completedAt: Date | null }[]).map((l) => {
      const results = labValues[l.id] ?? [];
      return {
        id: l.id, testName: l.testName, status: l.status, reportFileUrl: l.reportFileUrl,
        createdAt: l.createdAt.toISOString().slice(0, 10),
        completedAt: l.completedAt ? l.completedAt.toISOString().slice(0, 10) : null,
        results,
        abnormal: abnormalCount(results),
      };
    }),
    /** The scanned handwritten prescriptions - the doctor's own record. */
    prescriptions: (scans as {
      id: string; appointmentId: string | null; fileUrl: string | null; fileName: string | null; title: string | null; doctorName: string | null;
      status: string; createdAt: Date;
      appointment: { opNumber: string; visitDate: Date; doctor: { name: string } | null } | null;
    }[]).map((p) => ({
      id: p.id, appointmentId: p.appointmentId, fileUrl: p.fileUrl, fileName: p.fileName, title: p.title,
      doctorName: p.doctorName ?? p.appointment?.doctor?.name ?? null,
      status: p.status,
      createdAt: p.createdAt.toISOString().slice(0, 10),
      visitDate: p.appointment ? p.appointment.visitDate.toISOString().slice(0, 10) : null,
    })),
  };
}
