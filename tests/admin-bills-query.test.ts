import { describe, it, expect } from "vitest";
import {
  parseAdminBillsQuery, buildAdminBillsWhere, billDateRangeWhere, billPayWhere,
  clampBillsPage, clampBillsPageSize, ADMIN_BILLS_PAGE_SIZE, ADMIN_BILLS_PAGE_MAX,
} from "@/lib/admin-bills-query";

/**
 * The admin register used to be the newest 200 bills, filtered in the browser -
 * so a search for an older receipt answered "no bills match" while the bill sat
 * in the database. Every filter is a query now, and these are what each one is
 * allowed to mean.
 */

const parse = (qs: string) => {
  const p = new URLSearchParams(qs);
  return parseAdminBillsQuery((k) => p.get(k));
};

describe("reading the register's filters off a URL", () => {
  it("gives the whole register, page 1, when nothing is asked for", () => {
    expect(parse("")).toEqual({
      q: undefined, searchBy: "ALL", source: undefined, status: undefined, pay: "ALL",
      from: undefined, to: undefined, page: 1, pageSize: ADMIN_BILLS_PAGE_SIZE,
    });
  });

  it("keeps the values it recognises", () => {
    expect(parse("q=ravi&searchBy=NAME&source=LAB&status=PAID&pay=SPLIT&from=2026-07-01&to=2026-07-12&page=3&pageSize=50")).toEqual({
      q: "ravi", searchBy: "NAME", source: "LAB", status: "PAID", pay: "SPLIT",
      from: "2026-07-01", to: "2026-07-12", page: 3, pageSize: 50,
    });
  });

  it("drops values it does not recognise instead of failing", () => {
    // A stale bookmark should give the full register, not a 400.
    const q = parse("source=DENTAL&status=paid&pay=CHEQUE&searchBy=PHONE&from=2026-02-31&to=yesterday");
    expect(q.source).toBeUndefined();
    expect(q.status).toBeUndefined();
    expect(q.pay).toBe("ALL");
    expect(q.searchBy).toBe("ALL");
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
  });

  it("treats a blank search as no search", () => {
    expect(parse("q=%20%20").q).toBeUndefined();
  });
});

describe("page and page size", () => {
  it("falls back to page 1 on junk", () => {
    for (const raw of [null, undefined, "", "0", "-3", "abc", "Infinity"]) expect(clampBillsPage(raw)).toBe(1);
    expect(clampBillsPage("2.7")).toBe(2);
    expect(clampBillsPage("40")).toBe(40);
  });

  it("falls back to the default size on junk, never to zero rows", () => {
    for (const raw of [null, undefined, "", "0", "-5", "junk", "0.5"]) expect(clampBillsPageSize(raw)).toBe(ADMIN_BILLS_PAGE_SIZE);
    expect(clampBillsPageSize("50")).toBe(50);
  });

  it("stops at the ceiling, however big the number in the URL", () => {
    expect(clampBillsPageSize(String(ADMIN_BILLS_PAGE_MAX + 1))).toBe(ADMIN_BILLS_PAGE_MAX);
    expect(clampBillsPageSize("99999999")).toBe(ADMIN_BILLS_PAGE_MAX);
  });
});

describe("the printed-date range", () => {
  it("matches a re-dated bill on its printed date and an untouched one on the day it was raised", () => {
    const day = { gte: new Date(2026, 6, 1), lt: new Date(2026, 6, 13) };
    expect(billDateRangeWhere("2026-07-01", "2026-07-12")).toEqual({
      OR: [{ billDate: day }, { billDate: null, createdAt: day }],
    });
  });

  it("includes the whole of the `to` day, and ends at midnight after it", () => {
    const w = billDateRangeWhere(undefined, "2026-07-31") as { OR: { billDate: { lt: Date } }[] };
    expect(w.OR[0].billDate.lt).toEqual(new Date(2026, 7, 1));
  });

  it("is open-ended in either direction", () => {
    const fromOnly = billDateRangeWhere("2026-07-01") as { OR: { billDate: object }[] };
    expect(fromOnly.OR[0].billDate).toEqual({ gte: new Date(2026, 6, 1) });
  });

  it("is no filter at all when neither end is set", () => {
    expect(billDateRangeWhere()).toBeNull();
  });
});

describe("payment buckets", () => {
  it("never puts a cashless bill in a counter bucket - Unpaid included", () => {
    for (const p of ["CASH", "UPI", "CARD", "SPLIT", "UNPAID"] as const) {
      expect(billPayWhere(p)).toMatchObject({ payer: { not: "INSURANCE" } });
    }
  });

  it("puts every insurance bill under Insurance, whatever was paid on it", () => {
    expect(billPayWhere("INSURANCE")).toEqual({ payer: "INSURANCE" });
  });

  it("files a Cash + UPI split under Split, not Cash", () => {
    expect(billPayWhere("CASH")).toEqual({
      payer: { not: "INSURANCE" },
      AND: [
        { payments: { some: { mode: { in: ["CASH"] }, amount: { gt: 0 } } } },
        { payments: { none: { mode: { in: ["UPI", "CARD", "NETBANKING", "OTHER"] }, amount: { gt: 0 } } } },
      ],
    });
  });

  it("calls a bill split only with two different tenders", () => {
    const w = billPayWhere("SPLIT") as { OR: { AND: { payments: { some: { mode: { in: string[] } } } }[] }[] };
    expect(w.OR).toHaveLength(5);
    for (const clause of w.OR) {
      const [one, other] = clause.AND.map((c) => c.payments.some.mode.in);
      expect(one).toHaveLength(1);
      expect(other).not.toContain(one[0]);
    }
  });

  it("does not let an insurer's settlement decide a counter bucket", () => {
    // It never shows as a chip, so it cannot make a bill Cash, Split or paid.
    const json = JSON.stringify([billPayWhere("CASH"), billPayWhere("SPLIT"), billPayWhere("UNPAID")]);
    expect(json).not.toContain('"INSURANCE"]');
    expect(json).not.toContain('"INSURANCE",');
  });

  it("is no filter for Any payment", () => {
    expect(billPayWhere("ALL")).toBeNull();
  });
});

describe("combining filters", () => {
  it("is an empty where with nothing chosen", () => {
    expect(buildAdminBillsWhere({ searchBy: "ALL", pay: "ALL" })).toEqual({});
  });

  it("keeps every OR - the search, the date range and Split all survive together", () => {
    const w = buildAdminBillsWhere({ q: "ravi", searchBy: "ALL", pay: "SPLIT", from: "2026-07-01" });
    const and = w.AND as object[];
    expect(and).toHaveLength(3);
    expect(and.every((c) => "OR" in c)).toBe(true);
  });

  it("searches only the column that was picked", () => {
    const like = { contains: "JM12", mode: "insensitive" };
    expect(buildAdminBillsWhere({ q: "JM12", searchBy: "RECEIPT", pay: "ALL" })).toEqual({ AND: [{ receiptNo: like }] });
    expect(buildAdminBillsWhere({ q: "JM12", searchBy: "NAME", pay: "ALL" })).toEqual({ AND: [{ patient: { fullName: like } }] });
    expect(buildAdminBillsWhere({ q: "JM12", searchBy: "UHID", pay: "ALL" })).toEqual({ AND: [{ patient: { displayId: like } }] });
  });

  it("searches all three columns for All fields", () => {
    const like = { contains: "ravi", mode: "insensitive" };
    expect(buildAdminBillsWhere({ q: "  ravi ", searchBy: "ALL", pay: "ALL" })).toEqual({
      AND: [{ OR: [{ receiptNo: like }, { patient: { fullName: like } }, { patient: { displayId: like } }] }],
    });
  });

  it("narrows by source and status exactly", () => {
    expect(buildAdminBillsWhere({ searchBy: "ALL", pay: "ALL", source: "IPD", status: "PENDING" })).toEqual({
      AND: [{ source: "IPD" }, { status: "PENDING" }],
    });
  });
});
