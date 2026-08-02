import { describe, it, expect } from "vitest";
import { admissionNoteSchema } from "@/server/validators/ipd";

/**
 * The record this file protects.
 *
 * Nursing notes used to be ONE mutable string on the Admission row. The evening
 * shift's entry overwrote the morning's, and neither carried an author or a
 * time. That is fine for a scratchpad and indefensible for a ward record: the
 * day a stay is questioned, the only thing anyone has is whatever text happened
 * to be in the box last.
 *
 * The table that replaced it is append-only BY CONTRACT - the service exposes
 * addAdmissionNote and listAdmissionNotes and deliberately no update or delete,
 * and the route is POST rather than PATCH for the same reason. A correction is a
 * NEW entry saying what it corrects, exactly as it is done on paper.
 *
 * This file pins the boundary. The append-only guarantee itself is structural:
 * there is no code path to break, which is the point.
 */

describe("one nursing entry", () => {
  it("accepts what a nurse actually writes at handover", () => {
    const r = admissionNoteSchema.safeParse({ body: "08:00 - BP 130/80, afebrile, tolerating orals." });
    expect(r.success).toBe(true);
  });

  it("refuses an empty entry", () => {
    // The table has no delete path, so a blank row could never be tidied away -
    // it would sit in the chronology forever saying nothing.
    expect(admissionNoteSchema.safeParse({ body: "" }).success).toBe(false);
    expect(admissionNoteSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(admissionNoteSchema.safeParse({ body: "\n\n" }).success).toBe(false);
    expect(admissionNoteSchema.safeParse({}).success).toBe(false);
  });

  it("trims the entry before storing it", () => {
    const r = admissionNoteSchema.safeParse({ body: "  dressing changed, wound clean  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe("dressing changed, wound clean");
  });

  it("keeps the newlines inside an entry", () => {
    // A shift note is often several lines. Only the ends are trimmed.
    const body = "08:00 - BP 130/80\n14:00 - dressing changed";
    const r = admissionNoteSchema.safeParse({ body });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.body).toBe(body);
  });

  it("caps a single entry at 4000 characters", () => {
    expect(admissionNoteSchema.safeParse({ body: "a".repeat(4000) }).success).toBe(true);
    expect(admissionNoteSchema.safeParse({ body: "a".repeat(4001) }).success).toBe(false);
  });

  it("takes the entry as `body`, not the old whole-stay `notes` field", () => {
    // The rename is deliberate and load-bearing: `notes` meant "the stay's
    // notes, replace them", `body` means "this entry". A client still sending
    // the old shape must fail loudly rather than silently store nothing.
    expect(admissionNoteSchema.safeParse({ notes: "BP 130/80" }).success).toBe(false);
  });
});
