import { prisma } from "@/lib/prisma";
import { nextId } from "@/lib/ids";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import type { AuthUser } from "@/lib/auth/types";
import type { RegisterPatientInput } from "@/server/validators/reception";
import type { Prisma } from "@prisma/client";
import { notAPatientPhone, phoneVariants, toBare10 } from "@/lib/phone";
import { nameKey, type PhoneMatch, type PhoneOnFile } from "@/lib/patient-duplicates";

/**
 * Patient shape returned to reception. Referral fields (referredByName /
 * referralSource) are ADMIN-ONLY and deliberately excluded here - one
 * serializer, so the admin-only fact can never leak from a desk response.
 */
export interface PatientDTO {
  id: string;
  displayId: string;
  fullName: string;
  firstName: string;
  lastName: string | null;
  age: number | null;
  dob: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  bloodGroup: string | null;
  phone: string;
  city: string | null;
  createdAt: string;
}

const patientSelect = {
  id: true, displayId: true, fullName: true, firstName: true, lastName: true,
  age: true, dob: true, gender: true, bloodGroup: true, phone: true, city: true, createdAt: true,
} as const;

function toPatientDTO(p: {
  id: string; displayId: string; fullName: string; firstName: string; lastName: string | null;
  age: number | null; dob: Date | null; gender: string | null; bloodGroup: string | null;
  phone: string; city: string | null; createdAt: Date;
}): PatientDTO {
  return {
    id: p.id, displayId: p.displayId, fullName: p.fullName, firstName: p.firstName,
    lastName: p.lastName, age: p.age, dob: p.dob ? p.dob.toISOString().slice(0, 10) : null,
    gender: (p.gender as PatientDTO["gender"]) ?? null, bloodGroup: p.bloodGroup,
    phone: p.phone, city: p.city, createdAt: p.createdAt.toISOString(),
  };
}

const nn = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** How many of the records on one number the 409 lists. The rest are counted. */
const MATCHES_SHOWN = 8;

/**
 * Everybody already registered on this mobile, the ones in a bed first.
 *
 * Every stored shape of the number is matched - phoneVariants - because a
 * record that only failed to match on "+91" is exactly the duplicate this
 * exists to stop.
 */
async function recordsOnPhone(tx: Prisma.TransactionClient, phone: string): Promise<PhoneMatch[]> {
  const rows = await tx.patient.findMany({
    where: { phone: { in: phoneVariants(phone) }, mergedIntoId: null, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      ...patientSelect,
      admissions: {
        where: { status: "ADMITTED" },
        take: 1,
        select: { id: true, ipNumber: true, bed: { select: { bedNo: true, ward: { select: { name: true } } } } },
      },
    },
  });
  return rows
    .map((r): PhoneMatch => {
      const a = r.admissions[0];
      return {
        ...toPatientDTO(r),
        admission: a ? { admissionId: a.id, ipNumber: a.ipNumber, ward: a.bed.ward.name, bedNo: a.bed.bedNo } : null,
      };
    })
    .sort((x, y) => Number(!!y.admission) - Number(!!x.admission));
}

/**
 * Register a patient. UHID + row created in one transaction so an ID is never
 * burned on failure. fullName is denormalized from the name parts for search.
 * Referral is stored as a snapshot string (admin-only), never a live FK.
 *
 * ONE PERSON, ONE JEEVA ID. Every desk that creates a patient ends here, and by
 * 29 Sep 2026 the desks had made 414 extra records on 151 numbers - a
 * pharmacy lookup that never matched, a lab form that only hinted, a register
 * page that never looked. A split record is how a stay's medicines went
 * missing from its IP bill and how a claim reached the insurer under two UHIDs.
 * So before a new ID is issued:
 *
 *   · same mobile, same name   -> refused outright. It is the same patient;
 *                                  use their record.
 *   · same mobile, other name  -> refused until the desk says why this is a
 *                                  different person (families share a phone),
 *                                  and that reason goes into the audit trail.
 *
 * Both come back as a 409 carrying the records on file (PhoneOnFile), which
 * every counter shows in the same dialog.
 */
export async function registerPatient(
  actor: AuthUser,
  input: RegisterPatientInput,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PatientDTO> {
  const fullName = [input.firstName, input.middleName, input.lastName]
    .map((x) => (x ? x.trim() : "")).filter(Boolean).join(" ");
  const reason = nn(input.sharedPhoneReason);

  const patient = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const onFile = await recordsOnPhone(tx, input.phone);
    if (onFile.length > 0) {
      const key = nameKey(fullName);
      const same = onFile.find((m) => nameKey(m.fullName) === key);
      if (same || !reason || reason.length < 3) {
        const details: PhoneOnFile = {
          code: "PHONE_ON_FILE",
          sameName: !!same,
          total: onFile.length,
          // The same-name record leads the list - it is the answer.
          matches: (same ? [same, ...onFile.filter((m) => m.id !== same.id)] : onFile).slice(0, MATCHES_SHOWN),
        };
        throw new ApiError(
          409,
          same
            ? `${same.fullName} is already registered on this number as ${same.displayId}. Use that record.`
            : `This mobile already has ${onFile.length} patient record${onFile.length === 1 ? "" : "s"}. ` +
              "Use theirs, or say why this is a different person.",
          details
        );
      }
    }

    const displayId = await nextId("PATIENT", { tx });

    const created = await tx.patient.create({
      data: {
        displayId,
        firstName: input.firstName.trim(),
        middleName: nn(input.middleName),
        lastName: nn(input.lastName),
        fullName,
        dob: nn(input.dob) ? new Date(input.dob as string) : null,
        age: input.age ?? null,
        gender: input.gender ?? null,
        bloodGroup: input.bloodGroup ?? null,
        maritalStatus: input.maritalStatus ?? null,
        phone: input.phone,
        alternatePhone: nn(input.alternatePhone),
        email: nn(input.email),
        address: nn(input.address),
        city: nn(input.city),
        state: nn(input.state),
        country: nn(input.country) ?? "India",
        postalCode: nn(input.postalCode),
        occupation: nn(input.occupation),
        nationality: nn(input.nationality),
        preferredLanguage: nn(input.preferredLanguage),
        emergencyContactName: nn(input.emergencyContactName),
        emergencyContactRelation: nn(input.emergencyContactRelation),
        emergencyContactPhone: nn(input.emergencyContactPhone),
        allergies: nn(input.allergies),
        govtIdNumber: nn(input.govtIdNumber),
        referredByName: nn(input.referredByName),
        referralSource: nn(input.referralSource),
        isVip: input.isVip ?? false,
        remarks: nn(input.remarks),
        createdById: actor.id,
      },
      select: patientSelect,
    });

    await logAudit(
      actor,
      {
        action: "PATIENT_REGISTERED", targetTable: "Patient", targetId: created.id,
        meta: {
          displayId: created.displayId,
          // Who else is on this number, and what the desk said about it.
          ...(onFile.length > 0
            ? { sharedPhoneWith: onFile.map((m) => m.displayId).slice(0, 20), sharedPhoneReason: reason }
            : {}),
        },
        ...ctx,
      },
      tx
    );
    return created;
  });

  return toPatientDTO(patient);
}

/** Search by name / UHID / phone. Merged + soft-deleted hidden. Newest first. */
export async function searchPatients(q: string, limit: number): Promise<PatientDTO[]> {
  const base = { mergedIntoId: null, deletedAt: null };
  // A phone typed or pasted with spaces, dashes or a country code must still
  // find the row. Numbers are stored as "+919848012345", so a raw `contains`
  // on "+91 98480 12345" matches nothing - strip the query down to its digits
  // and search on those as well as on the literal text.
  const digits = q.replace(/\D/g, "");
  const where = q
    ? {
        ...base,
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { displayId: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
        ],
      }
    : base;

  const rows = await prisma.patient.findMany({
    where, orderBy: { createdAt: "desc" }, take: limit, select: patientSelect,
  });
  return rows.map(toPatientDTO);
}

/** Recently registered patients (default list for booking/search screens). */
export async function recentPatients(limit = 8): Promise<PatientDTO[]> {
  const rows = await prisma.patient.findMany({
    where: { mergedIntoId: null, deletedAt: null },
    orderBy: { createdAt: "desc" }, take: limit, select: patientSelect,
  });
  return rows.map(toPatientDTO);
}

export async function getPatientByDisplayId(displayId: string): Promise<PatientDTO> {
  const p = await prisma.patient.findUnique({
    where: { displayId },
    select: { ...patientSelect, mergedIntoId: true, deletedAt: true },
  });
  if (!p || p.mergedIntoId || p.deletedAt) throw new ApiError(404, "No patient found with that ID");
  return toPatientDTO(p);
}

/**
 * Update a patient's registered details (reception/admin). Name parts recompute
 * fullName so search stays correct. Referral is a snapshot and is NOT editable
 * here - changing history would be exactly the drift we designed against.
 */
export async function updatePatient(
  actor: AuthUser,
  displayId: string,
  input: Partial<RegisterPatientInput>,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PatientDTO> {
  const existing = await prisma.patient.findUnique({
    where: { displayId },
    select: { id: true, firstName: true, middleName: true, lastName: true, phone: true, mergedIntoId: true, deletedAt: true },
  });
  if (!existing || existing.mergedIntoId || existing.deletedAt) throw new ApiError(404, "Patient not found");

  // A record already on the hospital's number can be saved as it is - that is
  // how the desk gets in to correct it. Moving a record ONTO one cannot.
  if (input.phone !== undefined && toBare10(input.phone) !== toBare10(existing.phone)) {
    const why = notAPatientPhone(input.phone);
    if (why) throw new ApiError(400, why);
  }

  const firstName = input.firstName?.trim() || existing.firstName;
  const middleName = input.middleName !== undefined ? nn(input.middleName) : existing.middleName;
  const lastName = input.lastName !== undefined ? nn(input.lastName) : existing.lastName;
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  const data: Record<string, unknown> = { firstName, middleName, lastName, fullName, updatedById: actor.id };
  const setIf = (k: keyof RegisterPatientInput, v: unknown) => { if (input[k] !== undefined) data[k as string] = v; };

  setIf("dob", nn(input.dob) ? new Date(input.dob as string) : null);
  setIf("age", input.age ?? null);
  setIf("gender", input.gender ?? null);
  setIf("bloodGroup", input.bloodGroup ?? null);
  setIf("maritalStatus", input.maritalStatus ?? null);
  setIf("phone", input.phone);
  setIf("alternatePhone", nn(input.alternatePhone));
  setIf("email", nn(input.email));
  setIf("address", nn(input.address));
  setIf("city", nn(input.city));
  setIf("state", nn(input.state));
  setIf("country", nn(input.country));
  setIf("postalCode", nn(input.postalCode));
  setIf("occupation", nn(input.occupation));
  setIf("nationality", nn(input.nationality));
  setIf("preferredLanguage", nn(input.preferredLanguage));
  setIf("isVip", input.isVip);
  setIf("remarks", nn(input.remarks));

  const updated = await prisma.patient.update({ where: { id: existing.id }, data, select: patientSelect });
  await logAudit(actor, { action: "PATIENT_UPDATED", targetTable: "Patient", targetId: existing.id, meta: { displayId }, ...ctx });
  return toPatientDTO(updated);
}

/** A patient updating their OWN contact details. Deliberately narrow. */
export async function updateOwnContact(
  patientId: string,
  input: { phone?: string; alternatePhone?: string; email?: string; address?: string; city?: string; state?: string; postalCode?: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<PatientDTO> {
  const data: Record<string, unknown> = {};
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.alternatePhone !== undefined) data.alternatePhone = nn(input.alternatePhone);
  if (input.email !== undefined) data.email = nn(input.email);
  if (input.address !== undefined) data.address = nn(input.address);
  if (input.city !== undefined) data.city = nn(input.city);
  if (input.state !== undefined) data.state = nn(input.state);
  if (input.postalCode !== undefined) data.postalCode = nn(input.postalCode);
  if (Object.keys(data).length === 0) throw new ApiError(400, "Nothing to update");

  const updated = await prisma.patient.update({ where: { id: patientId }, data, select: patientSelect });
  await logAudit({ id: patientId, role: "PATIENT" }, { action: "PATIENT_SELF_UPDATED", targetTable: "Patient", targetId: patientId, ...ctx });
  return toPatientDTO(updated);
}

/**
 * DUPLICATE PATIENTS - the same human, registered twice.
 *
 * It happens constantly: someone walks in, gives a phone number, gets a UHID.
 * Six months later they're admitted in an emergency and a different clerk
 * registers them again. Now their history is split across two records - and a
 * doctor checking allergies sees half of it. That is a clinical hazard, not an
 * admin annoyance.
 *
 * Every read in this codebase already refuses to show a merged patient
 * (`mergedIntoId` is guarded in eleven services). Only the merge itself was
 * missing.
 */

/** Two patients sharing a phone number are almost always one person. */
export async function findDuplicates(): Promise<{
  groups: {
    phone: string;
    /**
     * The hospital's own number, or another that is nobody's (notAPatientPhone).
     * The records on it are DIFFERENT people who had no phone to give - never
     * merge them; correct each one's number when they next come in.
     */
    placeholder: boolean;
    patients: {
      id: string; displayId: string; fullName: string; age: number | null;
      gender: string | null; createdAt: string;
      visits: number; bills: number; admitted: boolean; ipNumber: string | null;
    }[];
  }[];
}> {
  const rows = await prisma.patient.findMany({
    where: { mergedIntoId: null, deletedAt: null },
    select: {
      id: true, displayId: true, fullName: true, phone: true,
      age: true, gender: true, createdAt: true,
      _count: { select: { appointments: true, invoices: true } },
      admissions: { where: { status: "ADMITTED" }, select: { ipNumber: true } },
    },
  });

  type Row = {
    id: string; displayId: string; fullName: string; phone: string;
    age: number | null; gender: string | null; createdAt: Date;
    _count: { appointments: number; invoices: number };
    admissions: { ipNumber: string }[];
  };

  // Grouped on the bare ten digits, so a row written before the +91 migration
  // lands in the same group as its twin instead of hiding in one of its own.
  const byPhone = new Map<string, Row[]>();
  for (const r of rows as Row[]) {
    const key = toBare10(r.phone);
    if (!key) continue;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key)!.push(r);
  }

  return {
    groups: [...byPhone.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([phone, list]) => ({
        phone: `+91${phone}`,
        placeholder: notAPatientPhone(phone) !== null,
        patients: list
          // Oldest first - the original record is almost always the one to keep,
          // because it's the one with the longest history behind it.
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((p) => ({
            id: p.id, displayId: p.displayId, fullName: p.fullName,
            age: p.age, gender: p.gender,
            createdAt: p.createdAt.toISOString(),
            visits: p._count.appointments,
            bills: p._count.invoices,
            admitted: p.admissions.length > 0,
            ipNumber: p.admissions[0]?.ipNumber ?? null,
          })),
      }))
      // Real duplicates first; the placeholder crowds go to the bottom.
      .sort((a, b) => Number(a.placeholder) - Number(b.placeholder)),
  };
}

/**
 * Fold `mergeId` into `keepId`.
 *
 * Everything medical and financial moves across: visits, bills, lab tests,
 * prescriptions, admissions. The duplicate record is NOT deleted - nothing
 * medical ever is - it's marked `mergedIntoId` and becomes invisible to every
 * read in the system, while remaining in the audit trail forever.
 *
 * This is irreversible by design. A merge that could be undone would tempt
 * somebody to try it on a hunch.
 */
export async function mergePatients(
  actor: AuthUser,
  input: { keepId: string; mergeId: string; reason: string },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ kept: string; merged: string; moved: { visits: number; bills: number; tests: number; prescriptions: number; admissions: number } }> {
  if (input.keepId === input.mergeId) throw new ApiError(400, "That's the same record");
  if (!input.reason || input.reason.trim().length < 3) {
    throw new ApiError(400, "Say why these are the same person");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const [keep, merge] = await Promise.all([
      tx.patient.findUnique({
        where: { id: input.keepId },
        select: { id: true, displayId: true, fullName: true, mergedIntoId: true, deletedAt: true },
      }),
      tx.patient.findUnique({
        where: { id: input.mergeId },
        select: { id: true, displayId: true, fullName: true, mergedIntoId: true, deletedAt: true },
      }),
    ]);

    if (!keep || keep.mergedIntoId || keep.deletedAt) throw new ApiError(404, "The record you're keeping doesn't exist");
    if (!merge || merge.mergedIntoId || merge.deletedAt) throw new ApiError(404, "The record you're merging doesn't exist");

    // An admitted patient is physically in a bed. Moving their identity out from
    // under a live admission is how a ward ends up treating the wrong file - so
    // the record being folded AWAY may not have one.
    //
    // The record being KEPT may. Its admission never moves; the duplicate's
    // visits and bills move onto it, which is what the ward needs to see. This
    // used to refuse both ways, and so the one moment a duplicate matters most
    // - the patient is upstairs and half their history is on the other card -
    // was the one moment it could not be fixed.
    const liveAdmission = await tx.admission.findFirst({
      where: { patientId: merge.id, status: "ADMITTED" },
      select: { ipNumber: true },
    });
    if (liveAdmission) {
      throw new ApiError(
        409,
        `${merge.displayId} is in a bed right now (${liveAdmission.ipNumber}). Keep that record and merge the other one into it.`
      );
    }

    const [visits, bills, tests, prescriptions, admissions] = await Promise.all([
      tx.appointment.updateMany({ where: { patientId: merge.id }, data: { patientId: keep.id } }),
      tx.invoice.updateMany({ where: { patientId: merge.id }, data: { patientId: keep.id } }),
      tx.labTest.updateMany({ where: { patientId: merge.id }, data: { patientId: keep.id } }),
      tx.prescriptionUpload.updateMany({ where: { patientId: merge.id }, data: { patientId: keep.id } }),
      tx.admission.updateMany({ where: { patientId: merge.id }, data: { patientId: keep.id } }),
    ]);

    await tx.patient.update({
      where: { id: merge.id },
      data: { mergedIntoId: keep.id },
    });

    await logAudit(actor, {
      action: "PATIENTS_MERGED",
      targetTable: "Patient",
      targetId: keep.id,
      meta: {
        kept: keep.displayId,
        merged: merge.displayId,
        mergedName: merge.fullName,
        reason: input.reason.trim(),
        moved: {
          visits: visits.count, bills: bills.count, tests: tests.count,
          prescriptions: prescriptions.count, admissions: admissions.count,
        },
      },
      ...ctx,
    }, tx);

    return {
      kept: keep.displayId,
      merged: merge.displayId,
      moved: {
        visits: visits.count, bills: bills.count, tests: tests.count,
        prescriptions: prescriptions.count, admissions: admissions.count,
      },
    };
  });
}
