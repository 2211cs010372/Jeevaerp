/**
 * Audit trail querying.
 *
 * The hospital already writes a broad trail: 60-odd distinct actions covering
 * invoices, payments, refunds, dispensing, IPD charges, admissions, discharges,
 * lab results, stock and staff changes. What it could not do was READ it. The
 * admin page called listAuditLog(100), which took a row limit and nothing else -
 * no actor filter, no action filter, no date range, and it dropped targetId, meta
 * and the IP on the floor before returning.
 *
 * That is the difference between having records and being able to produce them.
 * "Show me everything recorded against this patient" and "what did this
 * pharmacist do on the 12th" are the two questions an audit trail exists to
 * answer - one medico-legal, one about money going missing - and neither could be
 * asked.
 *
 * The filter shape lives here, pure, so the parsing and the date-boundary
 * handling can be tested without a database.
 */

export interface AuditQuery {
  /** Staff user id. */
  actorUserId?: string;
  /** Case-insensitive substring, so "REFUND" finds INVOICE_REFUNDED. */
  action?: string;
  /** Exact table name, e.g. "Invoice". */
  targetTable?: string;
  /** Exact row id, e.g. an invoice or admission id. */
  targetId?: string;
  /** Inclusive ISO date (YYYY-MM-DD), local midnight. */
  from?: string;
  /** Inclusive ISO date (YYYY-MM-DD): the whole of this day is included. */
  to?: string;
  limit?: number;
  /** Rows to skip, for "load more". */
  offset?: number;
}

/** Hard ceiling on one page, so a wide date range cannot pull the whole table. */
export const AUDIT_MAX_LIMIT = 200;
export const AUDIT_DEFAULT_LIMIT = 100;

export interface AuditWhere {
  actorUserId?: string;
  action?: { equals: string } | { contains: string; mode: "insensitive" };
  targetTable?: string;
  targetId?: string;
  createdAt?: { gte?: Date; lt?: Date };
}

/**
 * An action name as the code writes them: SCREAMING_SNAKE_CASE.
 *
 * Used to decide exact-match versus substring. Every value the filter dropdown
 * offers is one of these, and exact match is the only form that can use the
 * [action, createdAt] index - `contains` scans the table, which at ~480,000 audit
 * rows a year is seconds per query.
 */
const EXACT_ACTION = /^[A-Z0-9_]+$/;

/**
 * Turn a query into a Prisma `where`.
 *
 * Empty and whitespace-only values are dropped rather than matched, so a filter
 * box the user cleared does not silently become `action contains ""` and quietly
 * change nothing while looking like it filtered.
 *
 * `to` is EXCLUSIVE-of-the-next-day rather than `lte: to`. A plain `lte` on a
 * date-only string compares against midnight, so asking for 1st to 12th returned
 * nothing that happened during the 12th - the day you are usually most interested
 * in. This is the classic off-by-one-day in a date filter and it hides evidence.
 */
export function buildAuditWhere(q: AuditQuery): AuditWhere {
  const where: AuditWhere = {};
  const clean = (s?: string) => {
    const t = s?.trim();
    return t ? t : undefined;
  };

  const actor = clean(q.actorUserId);
  if (actor) where.actorUserId = actor;

  const action = clean(q.action);
  if (action) {
    // A dropdown value is a complete action name, so it matches exactly and reads
    // off the index. A hand-typed fragment in the URL still works, by scan - a
    // rare path, and better than answering "no results" to a reasonable guess.
    where.action = EXACT_ACTION.test(action)
      ? { equals: action }
      : { contains: action, mode: "insensitive" };
  }

  const table = clean(q.targetTable);
  if (table) where.targetTable = table;

  const target = clean(q.targetId);
  if (target) where.targetId = target;

  const from = parseDayStart(clean(q.from));
  const to = parseDayStart(clean(q.to));
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    // The whole of the `to` day: midnight the following day, exclusive.
    if (to) where.createdAt.lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  }
  return where;
}

/**
 * Local midnight for a YYYY-MM-DD string, or undefined if it is not one.
 *
 * Local, not UTC. The person asking "what happened on the 12th" means the 12th at
 * the hospital; parsing as UTC would shift the window by five and a half hours in
 * India and put the evening's work on the wrong day.
 */
export function parseDayStart(s?: string): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  // Rejects 2026-02-31 and friends, which Date would otherwise roll forward into
  // March and answer a question nobody asked.
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return dt;
}

/** Clamp a requested page size into something the database is safe to be asked. */
export function clampLimit(n?: number): number {
  if (!Number.isFinite(n) || n === undefined) return AUDIT_DEFAULT_LIMIT;
  return Math.min(AUDIT_MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/** Non-negative offset, so a malformed page number cannot become a negative skip. */
export function clampOffset(n?: number): number {
  if (!Number.isFinite(n) || n === undefined) return 0;
  return Math.max(0, Math.floor(n));
}

/** True when the query would return the whole table - used to label the UI. */
export function isUnfiltered(q: AuditQuery): boolean {
  return !buildAuditWhere(q).actorUserId
    && !buildAuditWhere(q).action
    && !buildAuditWhere(q).targetTable
    && !buildAuditWhere(q).targetId
    && !buildAuditWhere(q).createdAt;
}
