import { describe, it, expect } from "vitest";
import { resolveBillDate, BillDateError } from "@/server/billing/calc";
import { invoiceDayWhere } from "@/server/services/billing.service";

/**
 * THE DATE PRINTED ON A GST DOCUMENT.
 *
 * A bill's printed date is the one field a desk can correct that leaves no mark
 * on the figures - re-date a bill by three days and every total still agrees, so
 * nothing downstream notices. That makes it the field most worth pinning down.
 *
 * The failure that motivated the noon anchoring is the quiet one: a server in
 * UTC serving a hospital at +05:30 turns local midnight into the previous
 * evening, and a bill dated the 12th prints as the 11th on the copy the patient
 * hands to their insurer.
 */

const at = (iso: string) => new Date(iso);

describe("what a corrected bill date resolves to", () => {
  it("lands on the day that was typed, not the one before it", () => {
    const d = resolveBillDate("2026-08-12", at("2026-08-13T10:00:00Z"))!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth() + 1).toBe(8);
    expect(d.getDate()).toBe(12);
  });

  it("anchors at noon, so no timezone either side moves the day", () => {
    // The load-bearing detail. At 00:00 a +05:30 offset lands on the 11th and a
    // -05:00 offset lands on the 12th; at 12:00 both land on the 12th.
    const d = resolveBillDate("2026-08-12", at("2026-08-13T10:00:00Z"))!;
    expect(d.getHours()).toBe(12);
  });

  it("back-dates freely - that is what the field is for", () => {
    // A sample taken Saturday and billed Monday is the whole reason this exists.
    const d = resolveBillDate("2026-01-03", at("2026-08-13T10:00:00Z"))!;
    expect(d.getDate()).toBe(3);
    expect(d.getMonth() + 1).toBe(1);
  });
});

describe("the two answers that are not a date", () => {
  it("passes undefined straight through, so Prisma leaves the column alone", () => {
    // "The caller did not send a date" must never be read as "clear it".
    expect(resolveBillDate(undefined)).toBeUndefined();
  });

  it("passes null through, which clears the correction", () => {
    expect(resolveBillDate(null)).toBeNull();
  });
});

describe("dates a counter must not be able to set", () => {
  it("refuses a bill dated into the next return period", () => {
    // Not a typo guard. Dating a bill forward moves revenue into a period it
    // was not earned in, and it should not be one keystroke away at a counter.
    expect(() => resolveBillDate("2026-09-30", at("2026-08-13T10:00:00Z")))
      .toThrow(/future/i);
  });

  it("still accepts today when the server has already rolled over", () => {
    // 23:58 at the desk on the 13th, past midnight UTC on the server. Refusing
    // "today" for two minutes a day is the kind of bug nobody can reproduce.
    expect(() => resolveBillDate("2026-08-13", at("2026-08-13T18:35:00Z"))).not.toThrow();
  });

  it("refuses a day that does not exist", () => {
    // Date() rolls 2026-02-31 into March rather than failing, so a typo would
    // silently become a different month on the printed bill.
    expect(() => resolveBillDate("2026-02-31", at("2026-08-13T10:00:00Z")))
      .toThrow(BillDateError);
  });

  it("refuses anything that is not YYYY-MM-DD", () => {
    for (const bad of ["12-08-2026", "2026/08/12", "12 Aug 2026", "", "yesterday"]) {
      expect(() => resolveBillDate(bad, at("2026-08-13T10:00:00Z")), bad).toThrow(BillDateError);
    }
  });
});

/**
 * ONE MEANING OF "THE BILL'S DATE", ACROSS TWO CONTROLS.
 *
 * The insurance desk's inline date box (redateBill) and the Edit dialog's date
 * field (updateInvoice) are two doors onto the same correction. They used to
 * write different columns: redateBill assigned `createdAt` - which is what the
 * day close and every GST return group money by - so tidying a claim file
 * silently moved that bill's money into a different day's takings, while the
 * dialog wrote `billDate` and moved nothing.
 *
 * Both now resolve their input the same way. These pin that down, because the
 * two are in separate services and nothing but a test notices them drifting.
 */
describe("the two date controls agree", () => {
  it("resolves the same input to the same instant", () => {
    // redateBill and updateInvoice both call resolveBillDate now. If one is ever
    // reverted to its own parsing, the same typed date starts meaning two
    // different stored values and only the printed sheet shows it.
    const a = resolveBillDate("2026-08-12", at("2026-08-13T10:00:00Z"))!;
    const b = resolveBillDate("2026-08-12", at("2026-08-13T10:00:00Z"))!;
    expect(a.getTime()).toBe(b.getTime());
    expect(a.getHours()).toBe(12);
  });

  it("keeps a corrected date on its own calendar day", () => {
    // The claim-file case: a bill re-dated to the day of admission must still
    // read as that day when the outside-the-stay flag compares it, whatever
    // timezone the server is in.
    const d = resolveBillDate("2026-08-01", at("2026-08-13T10:00:00Z"))!;
    expect(d.getDate()).toBe(1);
    expect(d.getMonth() + 1).toBe(8);
  });
});

describe("finding a bill under the day it shows", () => {
  /**
   * THE BUG THIS REPLACED. The pharmacy counter reported that bill dates "are
   * not editing and saving". The save was never broken - `billDate` was written
   * correctly every time. The LOOKUP was: "By date" filtered on `createdAt`, so
   * a bill re-dated to the 28th stayed findable only under the day it was typed.
   * The desk picked the 28th, saw nothing, and concluded it had not saved.
   */
  it("finds a bill that was re-dated INTO the chosen day", () => {
    const w = invoiceDayWhere("2026-08-28");
    expect(w).toHaveProperty("OR");
    const [redated] = (w as { OR: { billDate: { gte: Date; lt: Date } }[] }).OR;
    expect(redated.billDate.gte.getDate()).toBe(28);
    // Local midnight to local midnight - not UTC, or half of the 27th's takings
    // come back under the 28th.
    expect(redated.billDate.gte.getHours()).toBe(0);
    expect(redated.billDate.lt.getDate()).toBe(29);
  });

  it("still finds an ordinary bill under the day it was raised", () => {
    // The overwhelming majority: never re-dated, so createdAt IS the shown date.
    const w = invoiceDayWhere("2026-08-28") as {
      OR: [unknown, { billDate: null; createdAt: { gte: Date; lt: Date } }];
    };
    const plain = w.OR[1];
    expect(plain.billDate).toBeNull();
    expect(plain.createdAt.gte.getDate()).toBe(28);
  });

  it("does not narrow the list at all when no day is asked for", () => {
    // The working queue must stay the working queue.
    expect(invoiceDayWhere(undefined)).toEqual({});
    expect(invoiceDayWhere("")).toEqual({});
    expect(invoiceDayWhere("not-a-date")).toEqual({});
  });
});
