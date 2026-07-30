import { describe, it, expect } from "vitest";
import {
  ADMISSION_STATUSES, CLOSED_STATUSES, CLOSED_STATUS_LIST, DISCHARGE_OUTCOMES,
  isOpen, isClosed, OUTCOME_LABEL, OUTCOME_SHORT, OUTCOME_HELP, producesFinalBill,
} from "@/lib/admission-outcome";

/**
 * The regression this file locks down: "the stay is over" used to be written two
 * ways, `status === "DISCHARGED"` and `status !== "ADMITTED"`. Both read as
 * correct and only the second survived adding four outcomes. The first silently
 * dropped LAMA, ABSCONDED, TRANSFERRED_OUT and EXPIRED out of every list and
 * count that used it - including the recently-discharged list, which is the only
 * screen from which a bill can be re-printed after the patient has left.
 */

describe("the status vocabulary", () => {
  it("has exactly one open state", () => {
    const open = ADMISSION_STATUSES.filter(isOpen);
    expect(open).toEqual(["ADMITTED"]);
  });

  it("treats every non-admitted status as closed", () => {
    for (const s of CLOSED_STATUSES) expect(isClosed(s)).toBe(true);
  });

  it("does not treat an admitted stay as closed", () => {
    expect(isClosed("ADMITTED")).toBe(false);
    expect(isOpen("ADMITTED")).toBe(true);
  });

  it("keeps ADMITTED out of the outcomes a desk can pick", () => {
    // Choosing "Admitted" as how the stay ended is not a sentence.
    expect(DISCHARGE_OUTCOMES).not.toContain("ADMITTED");
  });

  it("covers the four endings a 50-bed hospital actually hits", () => {
    for (const s of ["LAMA", "ABSCONDED", "TRANSFERRED_OUT", "EXPIRED"]) {
      expect(CLOSED_STATUSES).toContain(s);
    }
  });

  it("keeps DISCHARGED first, so it stays the default in the picker", () => {
    expect(DISCHARGE_OUTCOMES[0]).toBe("DISCHARGED");
  });

  it("derives the full list from the closed one without losing or duplicating any", () => {
    expect(ADMISSION_STATUSES).toEqual(["ADMITTED", ...CLOSED_STATUSES]);
    expect(new Set(ADMISSION_STATUSES).size).toBe(ADMISSION_STATUSES.length);
  });

  it("exposes a mutable copy for query builders that reject readonly arrays", () => {
    expect(CLOSED_STATUS_LIST).toEqual([...CLOSED_STATUSES]);
    // Must be a copy, not the same reference, or a caller could mutate the source.
    expect(CLOSED_STATUS_LIST).not.toBe(CLOSED_STATUSES);
  });
});

describe("an unknown status is treated as closed, not open", () => {
  // Failing closed matters: reading a future status as ADMITTED would show a
  // stay as live, hold a bed against it, and let charges keep accruing.
  for (const s of ["", "UNKNOWN", "admitted", "Admitted", "DISCHARGED_2"]) {
    it(`${JSON.stringify(s)} is not open`, () => expect(isOpen(s)).toBe(false));
  }
});

describe("labels", () => {
  it("names every status in both lengths", () => {
    for (const s of ADMISSION_STATUSES) {
      expect(OUTCOME_LABEL[s]).toBeTruthy();
      expect(OUTCOME_SHORT[s]).toBeTruthy();
    }
  });

  it("explains every outcome the desk can choose", () => {
    for (const o of DISCHARGE_OUTCOMES) expect(OUTCOME_HELP[o]).toBeTruthy();
  });

  it("spells out LAMA rather than showing the enum token to a relative", () => {
    expect(OUTCOME_LABEL.LAMA).toBe("Left against medical advice");
    expect(OUTCOME_LABEL.TRANSFERRED_OUT).not.toContain("_");
  });

  it("keeps LAMA and ABSCONDED distinct, because consent is the difference", () => {
    // LAMA means the patient signed. ABSCONDED means nobody asked, because
    // nobody knew. Recording one as the other claims a signature that does not
    // exist, on a document a court may read.
    expect(OUTCOME_LABEL.LAMA).not.toBe(OUTCOME_LABEL.ABSCONDED);
    expect(OUTCOME_HELP.ABSCONDED.toLowerCase()).toContain("consent");
  });

  it("keeps the short form short enough for a list chip", () => {
    for (const s of ADMISSION_STATUSES) expect(OUTCOME_SHORT[s].length).toBeLessThanOrEqual(12);
  });
});

describe("billing", () => {
  it("bills every outcome, including a death", () => {
    // The bed was occupied and the medicines were given whatever the ending was.
    // A closure that produced no invoice would leave the stay missing from the
    // day close and unreconcilable later. Whether to COLLECT is a separate
    // decision the desk makes with the discount and the dues override.
    for (const o of DISCHARGE_OUTCOMES) expect(producesFinalBill(o)).toBe(true);
  });
});
