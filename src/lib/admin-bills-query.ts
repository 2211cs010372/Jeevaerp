/**
 * The admin console's bill register, as a query.
 *
 * "All bills" used to fetch the newest 200 invoices and filter them in the
 * browser, so the 201st bill was on no screen at all. Lifting the cap the same
 * way would have shipped the whole invoice table to the browser on every load
 * and on every live refresh - one per bill raised anywhere in the hospital.
 * So every filter runs in the database instead, and one page comes back: every
 * bill is reachable, and a load costs a page however long the history gets.
 *
 * The filter shape lives here, pure, like audit-query, so the parsing and what
 * each payment bucket means can be tested without a database.
 */
import type { Prisma } from "@prisma/client";
import { parseDayStart } from "./audit-query";

export const BILL_SOURCES = ["CONSULTATION", "LAB", "PHARMACY", "IPD", "OTHER"] as const;
export const BILL_STATUSES = ["PENDING", "PARTIALLY_PAID", "PAID", "REFUNDED", "CANCELLED"] as const;
/**
 * How a bill settled. INSURANCE sits alongside the tender types because it is
 * the answer to the same question, and "everything with the TPAs" is a
 * question the owner asks.
 */
export const BILL_PAY_FILTERS = ["ALL", "CASH", "UPI", "CARD", "SPLIT", "INSURANCE", "UNPAID"] as const;
/** Which column the search box reads. ALL is any of the three. */
export const BILL_SEARCH_FIELDS = ["ALL", "RECEIPT", "NAME", "UHID"] as const;

export type BillSource = (typeof BILL_SOURCES)[number];
export type BillStatus = (typeof BILL_STATUSES)[number];
export type BillPayFilter = (typeof BILL_PAY_FILTERS)[number];
export type BillSearchField = (typeof BILL_SEARCH_FIELDS)[number];

/**
 * The tenders a bill's payment chips are drawn from, in chip order.
 *
 * An INSURANCE-mode payment - an insurer's NEFT settling a claim - is
 * deliberately not one. It never shows as a chip, so it must not decide a
 * Cash / UPI / Split / Unpaid bucket either, or the filter and the row it
 * returns would disagree about how the bill was paid.
 */
export const COUNTER_MODES = ["CASH", "UPI", "CARD", "NETBANKING", "OTHER"] as const;
type CounterMode = (typeof COUNTER_MODES)[number];

export const ADMIN_BILLS_PAGE_SIZE = 25;
/** The most one page may hold, whatever the URL says. */
export const ADMIN_BILLS_PAGE_MAX = 100;

export interface AdminBillsQuery {
  /** Search text; blank means no search. */
  q?: string;
  searchBy: BillSearchField;
  source?: BillSource;
  status?: BillStatus;
  pay: BillPayFilter;
  /** Inclusive YYYY-MM-DD, on the date the bill PRINTS. */
  from?: string;
  /** Inclusive YYYY-MM-DD: the whole of this day is included. */
  to?: string;
  /** 1-based. */
  page: number;
  pageSize: number;
}

/** A 1-based page number off the URL. Junk is page 1, never an error. */
export function clampBillsPage(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Rows per page. Junk falls back to the default rather than to zero rows, and
 * a huge number stops at the ceiling - without one, `?pageSize=99999999` is the
 * uncapped read this module exists to avoid.
 */
export function clampBillsPageSize(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return ADMIN_BILLS_PAGE_SIZE;
  return Math.min(n, ADMIN_BILLS_PAGE_MAX);
}

/**
 * Read the register's filters off a URL.
 *
 * Anything unrecognised is dropped rather than rejected: a stale bookmark or a
 * hand-edited address should give the full register, not a 400 and an empty
 * screen.
 */
export function parseAdminBillsQuery(get: (key: string) => string | null): AdminBillsQuery {
  const pick = <T extends string>(list: readonly T[], v: string | null): T | undefined =>
    v !== null && (list as readonly string[]).includes(v) ? (v as T) : undefined;
  const day = (v: string | null) => {
    const t = v?.trim();
    return t && parseDayStart(t) ? t : undefined;
  };
  return {
    q: get("q")?.trim() || undefined,
    searchBy: pick(BILL_SEARCH_FIELDS, get("searchBy")) ?? "ALL",
    source: pick(BILL_SOURCES, get("source")),
    status: pick(BILL_STATUSES, get("status")),
    pay: pick(BILL_PAY_FILTERS, get("pay")) ?? "ALL",
    from: day(get("from")),
    to: day(get("to")),
    page: clampBillsPage(get("page")),
    pageSize: clampBillsPageSize(get("pageSize")),
  };
}

/**
 * Bills whose PRINTED date falls in [from, to], both days whole.
 *
 * The same rule as invoiceDayWhere in billing.service: a bill a desk re-dated
 * counts on the day it was re-dated to, and one never re-dated counts on the
 * day it was raised. `to` runs to midnight the following day, exclusive, so
 * "1st to 12th" includes what was billed during the 12th.
 */
export function billDateRangeWhere(from?: string, to?: string): Prisma.InvoiceWhereInput | null {
  const start = parseDayStart(from);
  const last = parseDayStart(to);
  if (!start && !last) return null;
  const range: { gte?: Date; lt?: Date } = {};
  if (start) range.gte = start;
  if (last) range.lt = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
  return { OR: [{ billDate: range }, { billDate: null, createdAt: range }] };
}

/** A payment that actually took money at a counter in one of `modes`. */
const took = (modes: CounterMode[]) => ({ mode: { in: modes }, amount: { gt: 0 } });
const otherThan = (m: CounterMode) => COUNTER_MODES.filter((x) => x !== m);

/**
 * What each payment bucket means, as a query - the same rules the page's chips
 * are drawn by.
 *
 * Every counter bucket excludes cashless bills, UNPAID included: "unpaid" means
 * somebody still owes us at the desk, which is exactly what an insurance bill
 * is not.
 */
export function billPayWhere(pay: BillPayFilter): Prisma.InvoiceWhereInput | null {
  if (pay === "ALL") return null;
  if (pay === "INSURANCE") return { payer: "INSURANCE" };
  const counter = { payer: { not: "INSURANCE" as const } };
  if (pay === "UNPAID") return { ...counter, payments: { none: took([...COUNTER_MODES]) } };
  if (pay === "SPLIT") {
    // Two or more distinct tenders. Some tender M, plus some tender that is not
    // M, for any M - which is "at least two" without counting.
    return {
      ...counter,
      OR: COUNTER_MODES.map((m) => ({
        AND: [{ payments: { some: took([m]) } }, { payments: { some: took(otherThan(m)) } }],
      })),
    };
  }
  // One tender and only that one - a Cash + UPI split is SPLIT, not CASH.
  return {
    ...counter,
    AND: [{ payments: { some: took([pay]) } }, { payments: { none: took(otherThan(pay)) } }],
  };
}

/**
 * Turn the filters into a Prisma `where`.
 *
 * Each filter is its own AND clause rather than spread into one object, because
 * three of them are ORs - the search, the date range and SPLIT - and spreading
 * would let the last one silently overwrite the others.
 */
export function buildAdminBillsWhere(
  q: Omit<AdminBillsQuery, "page" | "pageSize">,
): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (q.source) and.push({ source: q.source });
  if (q.status) and.push({ status: q.status });

  const pay = billPayWhere(q.pay);
  if (pay) and.push(pay);

  const range = billDateRangeWhere(q.from, q.to);
  if (range) and.push(range);

  const text = q.q?.trim();
  if (text) {
    const like = { contains: text, mode: "insensitive" as const };
    const by: Record<Exclude<BillSearchField, "ALL">, Prisma.InvoiceWhereInput> = {
      RECEIPT: { receiptNo: like },
      NAME: { patient: { fullName: like } },
      UHID: { patient: { displayId: like } },
    };
    and.push(q.searchBy === "ALL" ? { OR: [by.RECEIPT, by.NAME, by.UHID] } : by[q.searchBy]);
  }

  return and.length ? { AND: and } : {};
}
