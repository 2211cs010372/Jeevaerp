/** Mirrors the Role enum in schema.prisma. Keep the two in the same order. */
export const ROLES = [
  "PATIENT",
  "DOCTOR",
  "RECEPTIONIST",
  "LAB_TECH",
  "PHARMACIST",
  "INSURANCE_DESK",
  "ADMIN",
  "SUPERUSER",
] as const;

export type Role = (typeof ROLES)[number];

export interface AuthUser {
  /** User.id for staff, Patient.id when role === "PATIENT" */
  id: string;
  role: Role;
}
