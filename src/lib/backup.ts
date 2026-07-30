/**
 * Backup helpers, kept out of the scripts so the dangerous decisions are testable.
 *
 * The dangerous decision is `isSameDatabase`. restore-verify wipes whatever it
 * restores into, so the one bug that must never ship here is a restore drill
 * pointed at the live hospital database. That check has tests; the shell
 * plumbing around it does not need any.
 */

export interface PgTarget {
  host: string;
  port: string;
  database: string;
  user?: string;
}

/**
 * Pull the parts that identify a database out of a Postgres URL.
 *
 * Returns null rather than throwing on junk: callers are scripts that should
 * print a usable message, not a stack trace, when someone pastes half a URL.
 */
export function parsePgUrl(url: string): PgTarget | null {
  try {
    const u = new URL(url);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const database = u.pathname.replace(/^\//, "");
    if (!u.hostname || !database) return null;
    return {
      host: u.hostname.toLowerCase(),
      // Postgres' own default, applied so :5432 and an omitted port compare equal.
      port: u.port || "5432",
      database,
      user: u.username || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * True when two URLs point at the same physical database.
 *
 * Compares host, port and database name only. Credentials are deliberately
 * ignored: connecting as a different user to the same database still drops the
 * same tables, and a check that treated `postgres@db/jeeva` and `admin@db/jeeva`
 * as different targets would wave through exactly the mistake it exists to stop.
 *
 * Unparseable input returns true, i.e. "assume it is production". Failing closed
 * is the only safe default for a function guarding a destructive operation.
 */
export function isSameDatabase(a: string, b: string): boolean {
  const pa = parsePgUrl(a);
  const pb = parsePgUrl(b);
  if (!pa || !pb) return true;
  return pa.host === pb.host && pa.port === pb.port && pa.database === pb.database;
}

/**
 * Timestamped dump name, sortable as a plain string.
 *
 * ISO order is what makes rotation a slice instead of a date parse, so the
 * colons that ISO uses (illegal in Windows filenames) are swapped for hyphens
 * rather than the whole format being abandoned.
 */
export function backupFilename(at = new Date()): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
  return `jeeva-${stamp}.dump`;
}

/**
 * Split a list of dump filenames into the ones to keep and the ones to delete.
 *
 * Newest-first by name, which works because backupFilename is ISO-ordered.
 * `keep` below 1 is clamped to 1: a rotation setting of 0 would mean "delete the
 * backup you just took", and a typo in a cron file should not be able to say that.
 */
export function planRotation(
  files: string[],
  keep: number,
): { keep: string[]; remove: string[] } {
  const dumps = files.filter((f) => /^jeeva-.*\.dump$/.test(f)).sort().reverse();
  const n = Math.max(1, Math.floor(keep));
  return { keep: dumps.slice(0, n), remove: dumps.slice(n) };
}
