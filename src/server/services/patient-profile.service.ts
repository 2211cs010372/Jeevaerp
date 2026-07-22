import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { listPatientPrescriptions, type PrescriptionUploadDTO } from "./prescriptions.service";

export interface PatientProfileDTO {
  displayId: string;
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  dob: string | null;
  age: number | null;
  gender: string | null;
  bloodGroup: string | null;
  maritalStatus: string | null;
  phone: string;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  occupation: string | null;
  nationality: string | null;
  preferredLanguage: string | null;
  memberSince: string;
}

export interface PatientAppointmentDTO {
  opNumber: string;
  visitDate: string;
  time: string;
  status: string;
  doctorName: string;
  department: string;
  price: string;
}

/**
 * The patient's own full profile. NOTE: referral fields are intentionally
 * NOT included - those are admin-only and a patient never sees who referred them.
 */
export async function getPatientProfile(patientId: string): Promise<PatientProfileDTO> {
  const p = await prisma.patient.findUnique({
    where: { id: patientId },
    select: {
      displayId: true, fullName: true, firstName: true, middleName: true, lastName: true,
      dob: true, age: true, gender: true, bloodGroup: true, maritalStatus: true,
      phone: true, alternatePhone: true, email: true, address: true, city: true,
      state: true, country: true, postalCode: true, occupation: true, nationality: true,
      preferredLanguage: true, createdAt: true,
    },
  });
  if (!p) throw new ApiError(404, "Profile not found");

  return {
    displayId: p.displayId, fullName: p.fullName, firstName: p.firstName,
    middleName: p.middleName, lastName: p.lastName,
    dob: p.dob ? p.dob.toISOString().slice(0, 10) : null,
    age: p.age, gender: p.gender, bloodGroup: p.bloodGroup, maritalStatus: p.maritalStatus,
    phone: p.phone, alternatePhone: p.alternatePhone, email: p.email, address: p.address,
    city: p.city, state: p.state, country: p.country, postalCode: p.postalCode,
    occupation: p.occupation, nationality: p.nationality, preferredLanguage: p.preferredLanguage,
    memberSince: p.createdAt.toISOString().slice(0, 10),
  };
}

/** The patient's appointment history (their own visits). */
export async function getPatientAppointments(patientId: string): Promise<PatientAppointmentDTO[]> {
  const rows = await prisma.appointment.findMany({
    where: { patientId },
    orderBy: { visitDate: "desc" },
    select: {
      id: true, opNumber: true, visitDate: true, status: true, priceAtBooking: true,
      timeAtBooking: true,
      doctor: { select: { name: true, department: true } },
    },
  });
  return rows.map((a: {
    id: string; opNumber: string; visitDate: Date; status: string; priceAtBooking: { toString(): string };
    timeAtBooking: string; doctor: { name: string; department: string };
  }) => ({
    id: a.id,
    opNumber: a.opNumber,
    visitDate: a.visitDate.toISOString().slice(0, 10),
    time: a.timeAtBooking,
    status: a.status,
    doctorName: a.doctor.name,
    department: a.doctor.department,
    price: a.priceAtBooking.toString(),
  }));
}

export interface PatientLabTestDTO {
  id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; doctorName: string | null;
}
export interface PatientBillDTO {
  id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string;
}

/** The patient's own lab tests (newest first) with report-ready state. */
export async function getPatientLabTests(patientId: string): Promise<PatientLabTestDTO[]> {
  const rows = await prisma.labTest.findMany({
    where: { patientId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, testName: true, status: true, reportFileUrl: true, createdAt: true, completedAt: true,
      appointment: { select: { doctor: { select: { name: true } } } },
    },
  });
  return rows.map((t: {
    id: string; testName: string; status: string; reportFileUrl: string | null; createdAt: Date; completedAt: Date | null;
    appointment: { doctor: { name: string } } | null;
  }) => ({
    id: t.id, testName: t.testName, status: t.status,
    reportReady: Boolean(t.reportFileUrl),
    reportUrl: t.reportFileUrl,
    date: (t.completedAt ?? t.createdAt).toISOString().slice(0, 10),
    doctorName: t.appointment?.doctor.name ?? null,
  }));
}

/** The patient's own bills (newest first) with paid / balance derived from payments. */
export async function getPatientBills(patientId: string): Promise<PatientBillDTO[]> {
  const rows = await prisma.invoice.findMany({
    where: { patientId, status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, receiptNo: true, source: true, status: true, totalAmount: true, createdAt: true,
      payments: { select: { amount: true } },
    },
  });
  return rows.map((i: {
    id: string; receiptNo: string; source: string; status: string; totalAmount: { toString(): string }; createdAt: Date;
    payments: { amount: { toString(): string } }[];
  }) => {
    const total = Number(i.totalAmount.toString());
    const paid = i.payments.reduce((s, p) => s + Number(p.amount.toString()), 0);
    return {
      id: i.id, receiptNo: i.receiptNo, source: i.source, status: i.status,
      total: total.toFixed(2), paid: paid.toFixed(2), balance: Math.max(0, total - paid).toFixed(2),
      date: i.createdAt.toISOString().slice(0, 10),
    };
  });
}

/** Full bundle for the patient portal. */
export async function getPatientProfileBundle(patientId: string): Promise<{
  profile: PatientProfileDTO;
  appointments: PatientAppointmentDTO[];
  prescriptions: PrescriptionUploadDTO[];
  labTests: PatientLabTestDTO[];
  bills: PatientBillDTO[];
}> {
  const [profile, appointments, prescriptions, labTests, bills] = await Promise.all([
    getPatientProfile(patientId),
    getPatientAppointments(patientId),
    listPatientPrescriptions(patientId),
    getPatientLabTests(patientId),
    getPatientBills(patientId),
  ]);
  return { profile, appointments, prescriptions, labTests, bills };
}
