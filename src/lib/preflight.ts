/**
 * Go-live preflight checks, pure half.
 *
 * The IO half lives in scripts/preflight.ts. Everything here is the reasoning that
 * is easy to get subtly wrong and worth having tests on: which connection is the
 * pooled one, whether a pg_dump can actually dump this server, and how stale a
 * backup is allowed to be before it stops counting as one.
 */

export type Severity = "block" | "warn" | "ok";

export interface Check {
  name: string;
  severity: Severity;
  detail: string;
  /** What to do about it. Omitted when severity is "ok". */
  fix?: string;
}

/**
 * Is this URL a TRANSACTION-pooled connection?
 *
 * This is the one that breaks things. pgbouncer in transaction mode implements
 * neither DDL nor the statements pg_dump issues, so a DIRECT_URL pointing at it
 * gives failing migrations and backups that fail or return quietly incomplete -
 * the worst of the three outcomes.
 *
 * WHAT THIS DELIBERATELY DOES NOT FLAG: the pooler HOSTNAME. Supabase serves two
 * modes on the same host - 6543 is transaction mode, 5432 is SESSION mode, which
 * is a passthrough that runs DDL and pg_dump perfectly well. An earlier version of
 * this check keyed on the hostname and reported a working, migrated setup as a
 * blocker. A preflight that cries wolf gets ignored, and then it is worth less
 * than no preflight at all, so the rule is the mode and never the host.
 */
export function isTransactionPooled(url: string): boolean {
  if (/pgbouncer=true/i.test(url)) return true;
  if (/pool_mode=transaction/i.test(url)) return true;
  try {
    return new URL(url).port === "6543";
  } catch {
    return false;
  }
}

/**
 * Is this the pooler host in session mode - workable, but not the truly direct
 * endpoint? Worth naming in the report rather than treating as a fault.
 */
export function isSessionPooler(url: string): boolean {
  if (isTransactionPooled(url)) return false;
  try {
    return /(^|\.)pooler\./i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Major version out of "17.6", "PostgreSQL 17.6 on aarch64…", "pg_dump (PostgreSQL) 17.2". */
export function pgMajor(version: string): number | null {
  const m = version.match(/(?:PostgreSQL\)?\s+)?(\d{1,2})(?:\.\d+)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  // Postgres majors are 8..99 in any plausible install; anything else is a
  // mis-parse of some other number in the string.
  return n >= 8 && n <= 99 ? n : null;
}

/**
 * Can a pg_dump of this major version dump a server of that major version?
 *
 * The rule is one-directional: pg_dump refuses a server NEWER than itself, and
 * dumping an older server is supported. So installing client 15 against a 17
 * server fails, which is exactly the mistake the installer instructions have to
 * prevent.
 */
export function clientCanDump(clientMajor: number, serverMajor: number): boolean {
  return clientMajor >= serverMajor;
}

/** Hours since a backup was taken, given its mtime. */
export function dumpAgeHours(mtime: Date, now = new Date()): number {
  return (now.getTime() - mtime.getTime()) / 3_600_000;
}

/**
 * How stale a backup may be before it stops counting.
 *
 * 36 hours, not 24: a nightly job that runs at 2 AM and is checked at lunchtime
 * the next day is 34 hours old and perfectly healthy. A 24-hour threshold would
 * cry wolf every afternoon, and a check that cries wolf gets ignored, which is
 * worse than not having it.
 */
export const BACKUP_STALE_HOURS = 36;

/**
 * Does production need COOKIE_DOMAIN set?
 *
 * Yes as soon as the site is served from a real host, because the portals are
 * subdomain-routed: without a shared parent domain on the cookie, a session set at
 * reception.example.com is invisible at admin.example.com. Staff sign in
 * successfully and land back on the login screen, and it reads as broken auth
 * rather than as one unset variable.
 *
 * Not needed for localhost, where there are no subdomains to share across.
 */
export function needsCookieDomain(siteUrl?: string): boolean {
  if (!siteUrl) return false;
  try {
    const host = new URL(siteUrl).hostname;
    return host !== "localhost" && !/^127\.|^0\.0\.0\.0$/.test(host);
  } catch {
    return false;
  }
}

/**
 * Is COOKIE_DOMAIN usable for subdomain sharing?
 *
 * It has to be the parent domain with a leading dot (".example.com"). A value of
 * "reception.example.com" scopes the cookie to that one portal and breaks the
 * others, which is a harder bug to spot than leaving it empty.
 */
export function cookieDomainLooksShared(domain: string, siteUrl?: string): boolean {
  const d = domain.trim();
  if (!d.startsWith(".")) return false;
  if (!siteUrl) return true;
  try {
    const host = new URL(siteUrl).hostname;
    return host === d.slice(1) || host.endsWith(d);
  } catch {
    return true;
  }
}

/** Worst severity in a list, for the process exit code. */
export function worst(checks: Check[]): Severity {
  if (checks.some((c) => c.severity === "block")) return "block";
  if (checks.some((c) => c.severity === "warn")) return "warn";
  return "ok";
}
