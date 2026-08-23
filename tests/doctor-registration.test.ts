import { describe, it, expect } from "vitest";
import { createDoctorSchema, updateDoctorSchema } from "@/server/validators/doctor-profile";

/**
 * ONE BOX THAT BOTH ADDS AND EDITS A DOCTOR'S REGISTRATION NUMBER.
 *
 * The desk sees a single "Registration no." input: empty when nothing has been
 * recorded, filled when it has, and typing in it saves either way. That is only
 * true if three things hold at the edges, and none of them are visible from the
 * screen - so they are pinned here.
 *
 *   1. CREATE may omit it entirely. A locum's number is routinely chased up
 *      days after they first sit a clinic; requiring it would block adding them
 *      to the roster at all.
 *   2. UPDATE accepts it ON ITS OWN. `updateDoctorSchema` is generated from the
 *      create schema by mapping every key to optional, and that mapping is
 *      written with a cast - a new field can silently fail to come through it,
 *      which would reject a save that changed only this box.
 *   3. UPDATE accepts the EMPTY STRING, because that is how the box says
 *      "remove it". Undefined and "" have to stay different all the way down:
 *      undefined means the caller was silent and the stored value stands, ""
 *      means somebody cleared it on purpose and the service writes null.
 */

const base = {
  name: "Dr A Santhosh",
  specialization: "Physician",
  department: "General Medicine",
  consultationFee: 400,
};

describe("adding a doctor", () => {
  it("does not require a registration number", () => {
    expect(createDoctorSchema.safeParse(base).success).toBe(true);
  });

  it("takes one when it is offered, trimmed", () => {
    const r = createDoctorSchema.safeParse({ ...base, registrationNo: "  APMC 78901  " });
    expect(r.success && r.data.registrationNo).toBe("APMC 78901");
  });

  it("accepts however a council chooses to number its doctors", () => {
    // Free text on purpose - a format check written against one state council
    // rejects all the others.
    for (const no of ["TSMC/FMR/12345", "APMC 78901", "MCI-2011-44112", "68321"]) {
      expect(createDoctorSchema.safeParse({ ...base, registrationNo: no }).success, no).toBe(true);
    }
  });
});

describe("editing a doctor", () => {
  it("accepts the registration number on its own", () => {
    // The desk edits one field at a time; this is the whole point of the box.
    const r = updateDoctorSchema.safeParse({ registrationNo: "TSMC/FMR/12345" });
    expect(r.success && r.data.registrationNo).toBe("TSMC/FMR/12345");
  });

  it("accepts an empty string, which is how the box is cleared", () => {
    // Distinct from omitting it - the service turns "" into null and leaves an
    // absent key alone.
    expect(updateDoctorSchema.safeParse({ registrationNo: "" }).success).toBe(true);
  });

  it("leaves the stored value alone when the key is absent", () => {
    const r = updateDoctorSchema.safeParse({ name: "Dr A Santhosh" });
    expect(r.success && "registrationNo" in r.data).toBe(false);
  });
});

describe("the one limit on it", () => {
  it("refuses something too long to be a registration number", () => {
    expect(createDoctorSchema.safeParse({ ...base, registrationNo: "x".repeat(61) }).success).toBe(false);
    expect(createDoctorSchema.safeParse({ ...base, registrationNo: "x".repeat(60) }).success).toBe(true);
  });
});
