import { describe, it, expect } from "vitest";
import { isOldStay } from "@/lib/old-stays";

/**
 * Which stays are "old members" (owner, 1 Oct 2026): discharged before
 * 01 Oct 2026 in the hospital's calendar. Forgotten bills on them never leave a
 * due. The edge that matters is IST: a discharge just after midnight IST on
 * 1 Oct is NOT old, even though UTC still says 30 Sep.
 */
describe("which stays are old", () => {
  it("is old when discharged before 01 Oct 2026", () => {
    expect(isOldStay("2026-08-10T10:05:00.000Z")).toBe(true);
    expect(isOldStay(new Date("2026-09-30T17:00:00.000Z"))).toBe(true); // 22:30 IST, 30 Sep
  });

  it("is not old from 01 Oct 2026 on, in IST", () => {
    expect(isOldStay("2026-09-30T19:00:00.000Z")).toBe(false); // 00:30 IST, 1 Oct
    expect(isOldStay("2026-10-05T09:00:00.000Z")).toBe(false);
  });

  it("is never old while the patient is still in the bed", () => {
    expect(isOldStay(null)).toBe(false);
    expect(isOldStay(undefined)).toBe(false);
    expect(isOldStay("not a date")).toBe(false);
  });
});
