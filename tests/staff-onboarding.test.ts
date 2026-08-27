import { describe, it, expect } from "vitest";
import { createStaffSchema, updateStaffSchema } from "@/server/validators/admin";

/**
 * Admin -> Staff is the only way a doctor or a staff login enters the system:
 * nothing is seeded any more. So this schema is the whole boundary between an
 * admin's typing and a consultant appearing on the public directory, and what
 * it accepts is pinned here.
 */

const staff = {
  username: "reception.ravi",
  name: "Ravi Kumar",
  phone: "9848012345",
  role: "RECEPTIONIST",
  password: "Password123!",
};

const doctorProfile = {
  specialization: "Obstetrician & Gynaecologist",
  department: "Gynaecology",
  consultationFee: 600,
  qualification: "MBBS, MS",
  experienceYears: 12,
  age: 40,
  languages: "Telugu, English",
  photoUrl: "https://project.supabase.co/storage/v1/object/public/doctor-photos/doctors/x.jpg",
  bio: "Antenatal care and gynaecological surgery.",
};

const doctor = { ...staff, username: "doctor.shireesha", name: "Dr. Shireesha M", role: "DOCTOR", doctor: doctorProfile };

describe("creating a non-doctor account", () => {
  it("takes the five basics and needs no profile", () => {
    const r = createStaffSchema.safeParse(staff);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.doctor).toBeUndefined();
  });

  it("stores the mobile in E.164, whatever shape was typed", () => {
    // Staff numbers share the patient format - one value reaches the database.
    for (const shape of ["+91 98480 12345", "9848012345", "09848012345"]) {
      const r = createStaffSchema.safeParse({ ...staff, phone: shape });
      expect(r.success, shape).toBe(true);
      if (r.success) expect(r.data.phone, shape).toBe("+919848012345");
    }
  });

  it("cannot mint a SUPERUSER", () => {
    // The developers' role is seeded by hand and is deliberately not on this
    // enum: an admin with the HR screen open must not be able to create an
    // account that outranks them and that their own staff list will not show.
    expect(createStaffSchema.safeParse({ ...staff, username: "admin.dev", role: "SUPERUSER" }).success).toBe(false);
  });

  it("insists the username is role.name", () => {
    // A bare handle gives no clue which portal the login opens, and the admin
    // page builds the prefix from the selected role for exactly that reason.
    expect(createStaffSchema.safeParse({ ...staff, username: "ravi" }).success).toBe(false);
    expect(createStaffSchema.safeParse({ ...staff, username: "frontdesk.ravi" }).success).toBe(false);
  });

  it("refuses a password short enough to guess", () => {
    expect(createStaffSchema.safeParse({ ...staff, password: "abc123" }).success).toBe(false);
  });
});

describe("creating a doctor", () => {
  it("accepts the full consulting profile", () => {
    const r = createStaffSchema.safeParse(doctor);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.doctor?.consultationFee).toBe(600);
      expect(r.data.doctor?.experienceYears).toBe(12);
    }
  });

  it("refuses a doctor with no profile at all", () => {
    // A Doctor row is what the directory and the booking grid read. Creating the
    // login without one produces a consultant nobody can find or book.
    const { doctor: _omitted, ...noProfile } = doctor;
    const r = createStaffSchema.safeParse(noProfile);
    expect(r.success).toBe(false);
  });

  it("refuses a profile with no specialization or department", () => {
    // The public directory groups on department; an empty one lands the doctor
    // in a section that does not exist.
    for (const missing of ["specialization", "department"]) {
      const r = createStaffSchema.safeParse({
        ...doctor,
        doctor: { ...doctorProfile, [missing]: "" },
      });
      expect(r.success, missing).toBe(false);
    }
  });

  it("allows a zero fee but not a negative one", () => {
    // Zero is real - anaesthetists are billed through the surgical team, so
    // their consultation carries no separate charge.
    expect(createStaffSchema.safeParse({ ...doctor, doctor: { ...doctorProfile, consultationFee: 0 } }).success).toBe(true);
    expect(createStaffSchema.safeParse({ ...doctor, doctor: { ...doctorProfile, consultationFee: -100 } }).success).toBe(false);
  });

  it("coerces the numbers a form sends as strings", () => {
    const r = createStaffSchema.safeParse({
      ...doctor,
      doctor: { ...doctorProfile, consultationFee: "600", experienceYears: "12", age: "40" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.doctor?.consultationFee).toBe(600);
      expect(r.data.doctor?.age).toBe(40);
    }
  });

  it("takes a /public path or an https URL for the photo, and nothing else", () => {
    const withPhoto = (photoUrl: string) =>
      createStaffSchema.safeParse({ ...doctor, doctor: { ...doctorProfile, photoUrl } }).success;

    expect(withPhoto("/images/doctor-1.avif")).toBe(true);
    expect(withPhoto("https://project.supabase.co/storage/v1/object/public/doctor-photos/x.jpg")).toBe(true);
    expect(withPhoto("")).toBe(true);
    // http:// is blocked as mixed content by the browser, so accepting it only
    // produces a card with a hole where the portrait should be.
    expect(withPhoto("http://example.com/x.jpg")).toBe(false);
    expect(withPhoto("javascript:alert(1)")).toBe(false);
  });
});

describe("editing an account", () => {
  it("accepts a change to one field alone", () => {
    const r = updateStaffSchema.safeParse({ name: "Ravi Kumar Reddy" });
    expect(r.success).toBe(true);
  });

  it("treats an empty password as 'leave it alone'", () => {
    // Not as 'clear it'. A null passwordHash locks anyone who signs in by
    // password out silently, leaving only the OTP route.
    const r = updateStaffSchema.safeParse({ password: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.password).toBe("");
  });

  it("still refuses a new password that is too short", () => {
    expect(updateStaffSchema.safeParse({ password: "abc123" }).success).toBe(false);
  });

  it("has no role field, so a role can never be edited", () => {
    // Moving a receptionist to DOCTOR would leave "reception.ravi" printed on a
    // consulting card; moving a doctor out would orphan their appointments.
    const r = updateStaffSchema.safeParse({ role: "ADMIN" });
    expect(r.success).toBe(true);
    if (r.success) expect("role" in r.data).toBe(false);
  });

  it("takes a partial doctor profile", () => {
    // The form sends the whole block, but a fee correction on its own is valid.
    const r = updateStaffSchema.safeParse({ doctor: { consultationFee: 750 } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.doctor?.consultationFee).toBe(750);
  });
});
