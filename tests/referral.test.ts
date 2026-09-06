import { describe, it, expect } from "vitest";
import { resolveReferral } from "@/lib/referral";

/**
 * The bug this was written against, in the hospital's own numbers: 275 of 513
 * patients carried a referral and 0 of 259 appointments did, so an admin
 * screen reading only the appointment showed every visit as "Walk-in".
 */
const visit = (name: string | null, source: string | null = null) => ({
  referredByName: name, referralSource: source,
});

describe("resolveReferral - which record answers 'who sent this patient in'", () => {
  it("falls back to the patient when the visit names nobody", () => {
    const r = resolveReferral(visit(null), visit("SRAVAN", "WALK IN"));
    expect(r.name).toBe("SRAVAN");
    expect(r.source).toBe("WALK IN");
    expect(r.fromPatient).toBe(true);
  });

  it("prefers the visit when the booking desk named somebody", () => {
    // A long-standing patient sent in once by a different doctor is that
    // doctor's referral for that visit.
    const r = resolveReferral(visit("Dr. Anil", "camp"), visit("SRAVAN", "WALK IN"));
    expect(r.name).toBe("Dr. Anil");
    expect(r.fromPatient).toBe(false);
  });

  it("never mixes the name from one record with the source from the other", () => {
    // "Dr. Anil / WALK IN" would be a sentence neither desk ever typed.
    const r = resolveReferral(visit("Dr. Anil", null), visit("SRAVAN", "WALK IN"));
    expect(r.name).toBe("Dr. Anil");
    expect(r.source).toBeNull();
  });

  it("treats blank and whitespace as not filled in", () => {
    const r = resolveReferral(visit("   ", "  "), visit("SRAVAN", "WALK IN"));
    expect(r.name).toBe("SRAVAN");
    expect(r.fromPatient).toBe(true);
  });

  it("keeps a source that names nobody, without inventing a referrer", () => {
    // One appointment in this database has a source and no name. It is worth
    // showing - the desk recorded it - but it can never enter a ranking.
    const r = resolveReferral(visit(null, "WALK IN"), visit(null, null));
    expect(r.name).toBeNull();
    expect(r.source).toBe("WALK IN");
  });

  it("is empty when neither record says anything", () => {
    const r = resolveReferral(visit(null), visit(null));
    expect(r).toEqual({ name: null, source: null, fromPatient: false });
  });

  it("survives a missing record on either side", () => {
    expect(resolveReferral(null, visit("SRAVAN")).name).toBe("SRAVAN");
    expect(resolveReferral(visit("Dr. Anil"), null).name).toBe("Dr. Anil");
    expect(resolveReferral(undefined, undefined).name).toBeNull();
  });
});
