import { describe, it, expect } from "vitest";
import {
  ADVISED_STATUSES, ADVISED_LABEL, advisedStatus, isOutstanding, mergeAdvice, dedupeAdvisedNames,
} from "@/lib/advised-lab";
import { orderTestsSchema } from "@/server/validators/labs";
import { declineAdvisedLabSchema } from "@/server/validators/reception";

/**
 * The bug this file locks down: a test the doctor advised used to be newline
 * text on the OPD sheet. Nothing turned it into an order and nothing could
 * answer "which of these was never done", so a test nobody re-typed silently
 * did not happen while the doctor went on waiting for the result.
 *
 * Everything below is the rule that replaced it: an advised line is ORDERED,
 * DECLINED or still OUTSTANDING, and only the last of those needs chasing.
 */

describe("what became of an advised test", () => {
  it("is outstanding until somebody acts on it", () => {
    expect(advisedStatus({ labTestId: null, declinedAt: null })).toBe("OUTSTANDING");
    expect(isOutstanding({ labTestId: null, declinedAt: null })).toBe(true);
  });

  it("is ordered once a lab test exists behind it", () => {
    expect(advisedStatus({ labTestId: "lt_1", declinedAt: null })).toBe("ORDERED");
    expect(isOutstanding({ labTestId: "lt_1", declinedAt: null })).toBe(false);
  });

  it("is declined when the desk said why it isn't needed", () => {
    expect(advisedStatus({ labTestId: null, declinedAt: new Date() })).toBe("DECLINED");
    expect(isOutstanding({ labTestId: null, declinedAt: new Date() })).toBe(false);
  });

  it("lets ORDERED win when both marks are somehow present", () => {
    // Marked not-needed, then ordered anyway - or two people acting at once.
    // A sample was taken and a bill exists, so reporting "not needed" would
    // hide a real test from the record. That is the worse mistake by far.
    expect(advisedStatus({ labTestId: "lt_1", declinedAt: new Date() })).toBe("ORDERED");
    expect(isOutstanding({ labTestId: "lt_1", declinedAt: new Date() })).toBe(false);
  });

  it("reads an ISO string the same as a Date", () => {
    // DTOs cross the wire as strings; the rule must not change shape with them.
    expect(advisedStatus({ labTestId: null, declinedAt: "2026-08-02T09:00:00.000Z" })).toBe("DECLINED");
  });

  it("names every state it can return", () => {
    for (const s of ADVISED_STATUSES) expect(ADVISED_LABEL[s]).toBeTruthy();
  });
});

describe("collapsing advice repeated across a stay", () => {
  it("shows a test advised three times and drawn once as ordered, once", () => {
    // Six-day stay, CBC written on three sheets, blood drawn once. Printing it
    // three times with two reading "not ordered" would send whoever reads the
    // summary hunting for tests that were never outstanding.
    const merged = mergeAdvice([
      { testName: "CBC", labTestId: null, declinedAt: null },
      { testName: "CBC", labTestId: "lt_1", declinedAt: null },
      { testName: "CBC", labTestId: null, declinedAt: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ name: "CBC", ordered: true, declined: false });
  });

  it("treats the same test typed two ways as one test", () => {
    const merged = mergeAdvice([
      { testName: "CBC", labTestId: null, declinedAt: null },
      { testName: "cbc", labTestId: "lt_1", declinedAt: null },
      { testName: " CBC ", labTestId: null, declinedAt: null },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].ordered).toBe(true);
  });

  it("keeps the first spelling the doctor used", () => {
    const merged = mergeAdvice([
      { testName: "CBC", labTestId: null, declinedAt: null },
      { testName: "cbc", labTestId: null, declinedAt: null },
    ]);
    expect(merged[0].name).toBe("CBC");
  });

  it("keeps genuinely different tests apart", () => {
    const merged = mergeAdvice([
      { testName: "CBC", labTestId: "lt_1", declinedAt: null },
      { testName: "LFT", labTestId: null, declinedAt: null },
      { testName: "RFT", labTestId: null, declinedAt: new Date() },
    ]);
    expect(merged.map((m) => m.name)).toEqual(["CBC", "LFT", "RFT"]);
    expect(merged[1]).toEqual({ name: "LFT", ordered: false, declined: false });
    expect(merged[2]).toEqual({ name: "RFT", ordered: false, declined: true });
  });

  it("drops blank lines rather than carrying an unnamed test", () => {
    const merged = mergeAdvice([
      { testName: "   ", labTestId: null, declinedAt: null },
      { testName: "", labTestId: null, declinedAt: null },
      { testName: "CBC", labTestId: null, declinedAt: null },
    ]);
    expect(merged).toHaveLength(1);
  });

  it("returns nothing when nothing was advised", () => {
    expect(mergeAdvice([])).toEqual([]);
  });
});

describe("de-duplicating what the desk typed on one sheet", () => {
  it("keeps CBC once when it was typed twice", () => {
    // Otherwise it appears twice on the outstanding list and clearing one
    // leaves a phantom behind.
    expect(dedupeAdvisedNames(["CBC", "LFT", "cbc"])).toEqual(["CBC", "LFT"]);
  });

  it("trims and drops blanks", () => {
    expect(dedupeAdvisedNames(["  CBC  ", "", "   ", "LFT"])).toEqual(["CBC", "LFT"]);
  });

  it("preserves the order they were written in", () => {
    expect(dedupeAdvisedNames(["RFT", "CBC", "LFT"])).toEqual(["RFT", "CBC", "LFT"]);
  });
});

describe("ordering tests from the advice", () => {
  const base = { patientId: "p_1", catalogIds: ["c_1"] };

  it("still accepts a plain walk-in order with no advice behind it", () => {
    expect(orderTestsSchema.safeParse(base).success).toBe(true);
  });

  it("accepts the advised rows the order fulfils", () => {
    const r = orderTestsSchema.safeParse({
      ...base,
      fromAdvised: [{ advisedLabId: "a_1", catalogId: "c_1" }],
    });
    expect(r.success).toBe(true);
  });

  it("refuses a half-filled link", () => {
    // A pair missing either side cannot close the loop, and accepting it would
    // leave the advice outstanding while looking like it had been handled.
    expect(orderTestsSchema.safeParse({ ...base, fromAdvised: [{ advisedLabId: "a_1" }] }).success).toBe(false);
    expect(orderTestsSchema.safeParse({ ...base, fromAdvised: [{ catalogId: "c_1" }] }).success).toBe(false);
    expect(orderTestsSchema.safeParse({ ...base, fromAdvised: [{ advisedLabId: "", catalogId: "c_1" }] }).success).toBe(false);
  });

  it("still needs at least one test to order", () => {
    expect(orderTestsSchema.safeParse({ ...base, catalogIds: [] }).success).toBe(false);
  });
});

describe("taking a test off the list without doing it", () => {
  it("requires a reason", () => {
    // An outstanding list that can be emptied with one silent click is worth
    // nothing: clearing it becomes the quickest way to make the warning go
    // away, and the record of why a doctor's instruction was not followed goes
    // with it.
    expect(declineAdvisedLabSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(declineAdvisedLabSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(declineAdvisedLabSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a reason too short to mean anything", () => {
    expect(declineAdvisedLabSchema.safeParse({ reason: "x" }).success).toBe(false);
  });

  it("accepts a real reason and trims it", () => {
    const r = declineAdvisedLabSchema.safeParse({ reason: "  Patient did it outside  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("Patient did it outside");
  });
});
