/**
 * ONE MOBILE, ALREADY ON FILE.
 *
 * Every screen that can create a patient - reception's Register and Book, the
 * pharmacy's direct sale, both lab counters - ends in the same server call, and
 * that call refuses to mint a second Jeeva ID on a number that already has one
 * until somebody has looked at who is there. The refusal is a 409 whose
 * `details` is a PhoneOnFile; the shared DuplicatePatientDialog renders it.
 *
 * Shared by server and browser, so nothing in here may touch Prisma.
 */

/** Where an existing record is lying right now, when it is in a bed. */
export interface MatchAdmission {
  admissionId: string;
  ipNumber: string;
  ward: string;
  bedNo: string;
}

/** A record already on the number - a PatientDTO plus its live stay. */
export interface PhoneMatch {
  id: string;
  displayId: string;
  fullName: string;
  firstName: string;
  age: number | null;
  dob: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  bloodGroup: string | null;
  phone: string;
  city: string | null;
  createdAt: string;
  admission: MatchAdmission | null;
}

export interface PhoneOnFile {
  code: "PHONE_ON_FILE";
  /**
   * The name being registered is already one of the matches. There is no
   * "different person" way out of this one - it is the same patient, typed in
   * again, and the only right answer is their existing record.
   */
  sameName: boolean;
  /** Everybody on the number; `matches` may be a shortened list. */
  total: number;
  matches: PhoneMatch[];
}

/**
 * A name as a clerk would compare it: case, dots and spacing ignored, and the
 * word order too - "Burra Ashok" and "Ashok Burra" are one man, surname first
 * on one chit and last on the other.
 */
export function nameKey(name: string): string {
  const key = name.toLowerCase().split(/[^a-z]+/).filter(Boolean).sort().join(" ");
  // A name typed in Telugu script has no a-z in it at all, and two of those
  // must not both collapse to "" and read as the same person.
  return key || name.trim().replace(/\s+/g, " ");
}

/** The PhoneOnFile inside a failed request, or null for any other failure. */
export function phoneOnFile(err: unknown): PhoneOnFile | null {
  const e = err as { status?: number; details?: { code?: string } } | null;
  if (e?.status !== 409 || e.details?.code !== "PHONE_ON_FILE") return null;
  return e.details as PhoneOnFile;
}
