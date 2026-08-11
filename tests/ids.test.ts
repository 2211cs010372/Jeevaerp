import { describe, it, expect } from "vitest";
import { formatId, FORMATS, PATIENT_FACING_KINDS, type IdKind } from "@/lib/id-formats";
import { isValidDocNo } from "@/lib/gst/einvoice-payload";

/**
 * Every number in here is read aloud over a phone, typed into a search box by
 * someone holding a queue, or scanned off paper. The failures these pin down are
 * all the same failure: two different documents that look like each other.
 *
 * The counter itself needs Postgres and is covered by tests/races.test.ts.
 * These are the shapes.
 */

describe("the printed shapes", () => {
  it("issues the numbers the front desk expects", () => {
    expect(formatId("PATIENT", 2026, 123)).toBe("JMH2026OP00123");
    expect(formatId("IP", 2026, 7)).toBe("JMH2026IP00007");
    expect(formatId("INVOICE", 2026, 312)).toBe("JMH20260312");
    expect(formatId("OP", 2026, 45)).toBe("JMH2026AP0045");
    expect(formatId("CLAIM", 2026, 45)).toBe("JMH2026CLM0045");
    expect(formatId("ADV", 2026, 12)).toBe("JMH2026ADV0012");
  });

  it("restarts the serial each year, and carries the year on the face of it", () => {
    expect(formatId("INVOICE", 2026, 1)).toBe("JMH20260001");
    expect(formatId("INVOICE", 2027, 1)).toBe("JMH20270001");
  });

  it("puts no hyphen in anything a patient or a scanner reads", () => {
    // The whole point of the scheme. A hyphen is what turns one number into
    // three over a phone line, and it is what a barcode scanner drops silently.
    for (const kind of PATIENT_FACING_KINDS) {
      for (const n of [1, 42, 9999, 10_000]) {
        expect(formatId(kind, 2026, n)).not.toContain("-");
      }
    }
  });
});

describe("no two kinds can collide", () => {
  /**
   * The one that matters. `receiptNo`, `opNumber`, `ipNumber` and `displayId`
   * are separate unique columns, so the database will not catch an overlap - a
   * human will, at the counter, when a bill number pulls up a patient. The
   * standing rule is that the marker after the year is unique per kind, and
   * this is what holds a future kind to it.
   */
  it("never issues the same string for two different kinds", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const kind of PATIENT_FACING_KINDS) {
      for (let n = 1; n <= 20_000; n++) {
        const id = formatId(kind, 2026, n);
        const owner = seen.get(id);
        if (owner) clashes.push(`${id} is issued as both ${owner} and ${kind}`);
        else seen.set(id, kind);
      }
    }
    // Collected and asserted once: an assertion per serial is 120,000 of them,
    // and this suite runs on every save.
    expect(clashes).toEqual([]);
  });

  it("keeps an invoice number from ever reading as a UHID or an admission", () => {
    // Bare digits after the year is what buys this: there is no serial at which
    // the invoice series grows an OP or an IP in the middle of it.
    for (const n of [1, 45, 123, 9999, 10_000, 999_999]) {
      const inv = formatId("INVOICE", 2026, n);
      expect(inv).toMatch(/^JMH2026\d+$/);
      expect(inv).not.toMatch(/OP|IP|AP|CLM|ADV/);
    }
  });

  it("stays unique across years, because receiptNo is unique for all time", () => {
    // Not merely unique within the year the GST return covers - the column is
    // globally unique, so a fixed-width year is load-bearing.
    const issued: string[] = [];
    for (const year of [2025, 2026, 2027]) {
      for (let n = 1; n <= 5_000; n++) issued.push(formatId("INVOICE", year, n));
    }
    expect(new Set(issued).size).toBe(issued.length);
  });
});

describe("the GST portal's rules on a document number", () => {
  it("accepts every invoice number this scheme can issue", () => {
    // Rejection at the IRP happens at filing time, long after the bill is in a
    // patient's hand and cannot be renumbered. Cheaper to know here.
    for (const n of [1, 312, 9999, 10_000, 999_999]) {
      const inv = formatId("INVOICE", 2026, n);
      expect(isValidDocNo(inv), `${inv} would be refused by the IRP`).toBe(true);
    }
  });

  it("leaves headroom under the portal's 16-character ceiling", () => {
    // 11 characters at four digits of serial. Six digits is still only 13, so
    // the ceiling is not something the hospital can grow into by accident.
    expect(formatId("INVOICE", 2026, 1)).toHaveLength(11);
    for (const kind of PATIENT_FACING_KINDS) {
      expect(formatId(kind, 2026, 999_999).length).toBeLessThanOrEqual(16);
    }
  });
});

describe("running past the padding", () => {
  it("widens the serial rather than truncating it", () => {
    // padStart is a floor. The 10,000th invoice of the year must not wrap round
    // to the 1st and hit the unique index - or worse, be refused as a duplicate
    // while a patient waits.
    expect(formatId("INVOICE", 2026, 9_999)).toBe("JMH20269999");
    expect(formatId("INVOICE", 2026, 10_000)).toBe("JMH202610000");
    expect(formatId("PATIENT", 2026, 100_000)).toBe("JMH2026OP100000");
  });
});

describe("the distributor-facing series", () => {
  it("is deliberately left on the old shape", () => {
    // These go out to suppliers, get quoted back on their statements, and are
    // matched against paperwork already in their files. Nothing a patient sees.
    expect(formatId("PO", 2026, 12)).toBe("PO-2026-000012");
    expect(formatId("GRN", 2026, 34)).toBe("GRN-2026-000034");
    expect(formatId("PRETURN", 2026, 8)).toBe("PR-2026-000008");
    expect(formatId("REQ", 2026, 12)).toBe("REQ-2026-000012");
  });

  it("covers every kind between the two lists, so a new one cannot be missed", () => {
    const distributor: IdKind[] = ["PO", "GRN", "PRETURN", "REQ"];
    const all = new Set<string>([...PATIENT_FACING_KINDS, ...distributor]);
    expect(new Set(Object.keys(FORMATS))).toEqual(all);
  });
});
