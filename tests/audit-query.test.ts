import { describe, it, expect } from "vitest";
import {
  buildAuditWhere, parseDayStart, clampLimit, clampOffset, isUnfiltered,
  AUDIT_MAX_LIMIT, AUDIT_DEFAULT_LIMIT,
} from "@/lib/audit-query";

/**
 * The date boundary is the reason this file exists.
 *
 * A naive `lte: to` on a date-only value compares against midnight at the START of
 * that day, so "1st to the 12th" silently excludes everything that happened during
 * the 12th - usually the day being investigated. On an audit trail that is not a
 * cosmetic bug: it hides evidence and does so while looking like it answered.
 */

describe("buildAuditWhere - the `to` day is included in full", () => {
  it("ends the range at midnight the FOLLOWING day, exclusively", () => {
    const w = buildAuditWhere({ from: "2026-07-01", to: "2026-07-12" });
    expect(w.createdAt?.gte).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(w.createdAt?.lt).toEqual(new Date(2026, 6, 13, 0, 0, 0, 0));
  });

  it("includes an event at 23:59 on the `to` day", () => {
    const w = buildAuditWhere({ to: "2026-07-12" });
    const lateThatNight = new Date(2026, 6, 12, 23, 59, 59);
    expect(lateThatNight.getTime()).toBeLessThan(w.createdAt!.lt!.getTime());
  });

  it("excludes the first moment of the day after", () => {
    const w = buildAuditWhere({ to: "2026-07-12" });
    const nextDay = new Date(2026, 6, 13, 0, 0, 0);
    expect(nextDay.getTime()).toBeGreaterThanOrEqual(w.createdAt!.lt!.getTime());
  });

  it("handles a single-day range, which must still contain that day", () => {
    const w = buildAuditWhere({ from: "2026-07-12", to: "2026-07-12" });
    const noon = new Date(2026, 6, 12, 12, 0, 0);
    expect(noon.getTime()).toBeGreaterThanOrEqual(w.createdAt!.gte!.getTime());
    expect(noon.getTime()).toBeLessThan(w.createdAt!.lt!.getTime());
  });

  it("accepts an open-ended range in either direction", () => {
    expect(buildAuditWhere({ from: "2026-07-01" }).createdAt).toEqual({ gte: new Date(2026, 6, 1) });
    expect(buildAuditWhere({ to: "2026-07-01" }).createdAt?.gte).toBeUndefined();
  });

  it("crosses a month boundary correctly", () => {
    const w = buildAuditWhere({ to: "2026-07-31" });
    expect(w.createdAt?.lt).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
  });
});

describe("buildAuditWhere - filters", () => {
  it("matches a dropdown value exactly, so it can use the index", () => {
    // Exact match is the only form the [action, createdAt] index can serve, and
    // every value the filter dropdown offers is a complete action name.
    expect(buildAuditWhere({ action: "INVOICE_REFUNDED" }).action).toEqual({
      equals: "INVOICE_REFUNDED",
    });
  });

  it("still finds a hand-typed fragment, by substring", () => {
    // Costs a scan, but answering "no results" to a reasonable guess is worse.
    expect(buildAuditWhere({ action: "refund" }).action).toEqual({
      contains: "refund", mode: "insensitive",
    });
  });

  it("treats a partial uppercase word as exact, not substring", () => {
    // "INVOICE" is a plausible dropdown-shaped value; exact is the safe read.
    expect(buildAuditWhere({ action: "INVOICE" }).action).toEqual({ equals: "INVOICE" });
  });

  it("matches a record id and table exactly", () => {
    const w = buildAuditWhere({ targetTable: "Invoice", targetId: "abc123" });
    expect(w.targetTable).toBe("Invoice");
    expect(w.targetId).toBe("abc123");
  });

  it("filters by actor", () => {
    expect(buildAuditWhere({ actorUserId: "u1" }).actorUserId).toBe("u1");
  });

  it("combines every filter at once", () => {
    const w = buildAuditWhere({
      actorUserId: "u1", action: "PAYMENT", targetTable: "Invoice",
      targetId: "inv1", from: "2026-07-01", to: "2026-07-02",
    });
    expect(Object.keys(w).sort()).toEqual(
      ["action", "actorUserId", "createdAt", "targetId", "targetTable"],
    );
  });

  it("drops cleared and whitespace-only filters instead of matching on empty", () => {
    // A cleared box must not become `action contains ""`, which filters nothing
    // while the UI implies it filtered something.
    const w = buildAuditWhere({ action: "", targetId: "   ", targetTable: undefined, from: "" });
    expect(w).toEqual({});
  });

  it("trims a pasted id, because a copied id arrives with whitespace", () => {
    expect(buildAuditWhere({ targetId: "  inv1\n" }).targetId).toBe("inv1");
  });
});

describe("parseDayStart - rejects what Date would silently roll forward", () => {
  it("parses a valid date at local midnight", () => {
    expect(parseDayStart("2026-07-12")).toEqual(new Date(2026, 6, 12, 0, 0, 0, 0));
  });

  it("rejects a day that does not exist rather than rolling into next month", () => {
    // new Date(2026, 1, 31) is 3 March. Answering a question about 31 February
    // with March's rows is worse than refusing.
    expect(parseDayStart("2026-02-31")).toBeUndefined();
    expect(parseDayStart("2026-13-01")).toBeUndefined();
  });

  it("accepts a real leap day and rejects a fake one", () => {
    expect(parseDayStart("2024-02-29")).toBeTruthy();
    expect(parseDayStart("2026-02-29")).toBeUndefined();
  });

  const junk = ["", "12-07-2026", "2026/07/12", "yesterday", "2026-7-2", undefined];
  for (const j of junk) {
    it(`rejects ${JSON.stringify(j)}`, () => expect(parseDayStart(j)).toBeUndefined());
  }
});

describe("clampLimit / clampOffset - a malformed page cannot pull the table", () => {
  it("defaults when absent", () => {
    expect(clampLimit(undefined)).toBe(AUDIT_DEFAULT_LIMIT);
    expect(clampOffset(undefined)).toBe(0);
  });

  it("caps an over-large limit", () => {
    expect(clampLimit(100_000)).toBe(AUDIT_MAX_LIMIT);
  });

  it("floors a limit of zero or below to one", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it("never returns a negative offset", () => {
    expect(clampOffset(-10)).toBe(0);
  });

  it("survives NaN from an unparseable query param", () => {
    expect(clampLimit(Number("abc"))).toBe(AUDIT_DEFAULT_LIMIT);
    expect(clampOffset(Number("abc"))).toBe(0);
  });

  it("truncates a fractional page size", () => {
    expect(clampLimit(10.9)).toBe(10);
  });
});

describe("isUnfiltered", () => {
  it("is true for an empty query", () => {
    expect(isUnfiltered({})).toBe(true);
    expect(isUnfiltered({ action: "", targetId: "  " })).toBe(true);
  });

  it("is false once anything real is set", () => {
    expect(isUnfiltered({ action: "PAYMENT" })).toBe(false);
    expect(isUnfiltered({ from: "2026-07-01" })).toBe(false);
  });

  it("ignores paging, which is not a filter", () => {
    expect(isUnfiltered({ limit: 50, offset: 100 })).toBe(true);
  });
});
