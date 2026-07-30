/**
 * Go-live preflight.
 *
 *   npm run preflight
 *
 * One command that answers "is this safe to point at a live hospital yet". Every
 * check here is something that has actually gone wrong or would go wrong silently:
 * a DIRECT_URL on the pooler, a pg_dump too old to dump the server, an unset
 * COOKIE_DOMAIN that makes subdomain login look broken, a migration that never
 * reached production, a backup nobody has taken.
 *
 * Exits non-zero when anything is BLOCK, so it can gate a deploy instead of being
 * a checklist somebody remembers to read.
 *
 * Read-only. It connects to the database to check migration state and server
 * version, and it never prints a secret - only names and derived facts.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  isTransactionPooled, isSessionPooler, pgMajor, clientCanDump, dumpAgeHours,
  BACKUP_STALE_HOURS, needsCookieDomain, cookieDomainLooksShared,
  type Check,
} from "../src/lib/preflight";

try { process.loadEnvFile(path.join(process.cwd(), ".env")); } catch { }

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);
const ok = (name: string, detail: string) => add({ name, severity: "ok", detail });
const warn = (name: string, detail: string, fix: string) => add({ name, severity: "warn", detail, fix });
const block = (name: string, detail: string, fix: string) => add({ name, severity: "block", detail, fix });

// ── Connections ────────────────────────────────────────────────────────────────
const dbUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;

if (!dbUrl) {
  block("DATABASE_URL", "not set", "Set it to the runtime (pooled) connection.");
} else {
  ok("DATABASE_URL", isTransactionPooled(dbUrl) ? "transaction pooler (correct for runtime)" : "session connection");
}

if (!directUrl) {
  block(
    "DIRECT_URL",
    "not set",
    "Set it to a session connection (Supabase: port 5432).\n" +
    "    Migrations and backups both need one; the transaction pooler serves neither.",
  );
} else if (isTransactionPooled(directUrl)) {
  block(
    "DIRECT_URL",
    "points at the TRANSACTION pooler (6543 / pgbouncer=true)",
    "Use a session connection on port 5432. In transaction mode, migrations fail and\n" +
    "    pg_dump fails or returns a quietly incomplete backup.",
  );
} else if (isSessionPooler(directUrl)) {
  // Works: session mode is a passthrough that runs DDL and pg_dump. Named rather
  // than flagged, so nobody goes hunting for a fault that is not there.
  ok("DIRECT_URL", "pooler host in session mode (port 5432) - supports DDL and pg_dump");
} else {
  ok("DIRECT_URL", "direct session connection");
}

// ── Secrets ───────────────────────────────────────────────────────────────────
for (const k of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
  const v = process.env[k];
  if (!v) block(k, "not set", `Generate one: openssl rand -hex 32`);
  else if (v.length < 32) block(k, `only ${v.length} chars`, "Must be at least 32. openssl rand -hex 32");
  else ok(k, `set, ${v.length} chars`);
}

// ── Subdomain sessions: the day-one killer ────────────────────────────────────
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() ?? "";

if (!siteUrl) {
  warn(
    "NEXT_PUBLIC_SITE_URL",
    "not set, falling back to the production domain",
    "Set it per environment. A staging build must not advertise the production host\n" +
    "    in canonical tags, OpenGraph or sitemap.xml.",
  );
} else {
  ok("NEXT_PUBLIC_SITE_URL", siteUrl);
}

if (needsCookieDomain(siteUrl)) {
  if (!cookieDomain) {
    block(
      "COOKIE_DOMAIN",
      "empty, but the site is on a real host",
      "Set it to the parent domain WITH a leading dot, e.g. .jeevamultispecialityhospital.com\n" +
      "    The portals are subdomain-routed: without this, a session set at reception.* is\n" +
      "    invisible at admin.*, and staff land back on the login screen after signing in.",
    );
  } else if (!cookieDomainLooksShared(cookieDomain, siteUrl)) {
    block(
      "COOKIE_DOMAIN",
      `"${cookieDomain}" will not be shared across portals`,
      "It needs a leading dot and must be the PARENT of the site host.\n" +
      "    A single-portal value scopes the cookie to that portal and breaks the others.",
    );
  } else {
    ok("COOKIE_DOMAIN", cookieDomain);
  }
} else {
  ok("COOKIE_DOMAIN", "not required for localhost");
}

// ── SMS ───────────────────────────────────────────────────────────────────────
if (!process.env.FAST2SMS_API_KEY && !process.env.TWO_FACTOR_API_KEY) {
  block(
    "SMS provider",
    "no key set",
    "Patients log in with an OTP. With no provider, production raises a hard failure\n" +
    "    and nobody can sign in to the patient portal or book online.",
  );
} else {
  ok("SMS provider", process.env.FAST2SMS_API_KEY ? "Fast2SMS key set" : "2Factor key set");
  if (!process.env.SMS_APPOINTMENT_TEMPLATE) {
    warn(
      "SMS_APPOINTMENT_TEMPLATE",
      "not set, booking confirmations are logged rather than sent",
      "Register a DLT template and set its id. OTPs are unaffected.",
    );
  }
}

// ── File storage ──────────────────────────────────────────────────────────────
// A miss here is silent and permanent: uploads still "succeed", they just land
// on a serverless filesystem that is thrown away at the next deploy, and the
// prescription scan is gone with no error anywhere.
const storageUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const haveS3 = Boolean(process.env.SUPABASE_S3_ACCESS_KEY_ID && process.env.SUPABASE_S3_SECRET_ACCESS_KEY);
const haveServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
// A NEXT_PUBLIC_ copy of any of these ships the credential to every browser.
const leaked = [
  "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_S3_SECRET_ACCESS_KEY",
  "NEXT_PUBLIC_SUPABASE_S3_ACCESS_KEY_ID",
].filter((k) => process.env[k]);

if (leaked.length > 0) {
  block(
    "Supabase Storage",
    `secret exposed under a public name: ${leaked.join(", ")}`,
    "Anything NEXT_PUBLIC_ is compiled into the browser bundle, and these keys bypass\n" +
    "    row-level security. Remove the public copy and rotate the key in the dashboard.",
  );
} else if (!storageUrl || (!haveS3 && !haveServiceRole)) {
  block(
    "Supabase Storage",
    !storageUrl ? "SUPABASE_URL not set" : "no S3 keys and no service-role key",
    "Prescription scans and lab reports fall back to local disk, which does not survive\n" +
    "    a deploy on Vercel - uploaded patient records are lost with no error shown.\n" +
    "    Set SUPABASE_S3_ACCESS_KEY_ID + SUPABASE_S3_SECRET_ACCESS_KEY, or\n" +
    "    SUPABASE_SERVICE_ROLE_KEY. See docs/supabase-storage.md.",
  );
} else {
  ok(
    "Supabase Storage",
    `${haveS3 ? "S3 keys" : "service-role key"} set (${process.env.SUPABASE_PHI_BUCKET || "patient-records"} must be a PRIVATE bucket)`,
  );
}

// ── Client tools, and whether they can dump THIS server ───────────────────────
const dumpProbe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
const haveDump = !dumpProbe.error && dumpProbe.status === 0;
const clientMajor = haveDump ? pgMajor(dumpProbe.stdout) : null;

if (!haveDump) {
  block(
    "pg_dump",
    "not on PATH",
    "Windows  winget install PostgreSQL.PostgreSQL.17\n" +
    "    macOS    brew install libpq && brew link --force libpq\n" +
    "    Debian   sudo apt install postgresql-client-17\n" +
    "    Then reopen the terminal. If it still fails, add the bin directory to PATH:\n" +
    "    C:\\Program Files\\PostgreSQL\\17\\bin",
  );
} else {
  ok("pg_dump", `${clientMajor ?? "?"} on PATH`);
}

// ── Backups ───────────────────────────────────────────────────────────────────
const backupDir = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const dumps = existsSync(backupDir)
  ? readdirSync(backupDir).filter((f) => /^jeeva-.*\.dump$/.test(f)).sort().reverse()
  : [];

if (dumps.length === 0) {
  block(
    "Backups",
    "none exist",
    "npm run backup\n" +
    "    Then prove it restores (npm run backup:verify) and write the RTO into\n" +
    "    docs/runbook-restore.md. An untested backup is not a backup.",
  );
} else {
  const newest = statSync(path.join(backupDir, dumps[0]));
  const hours = dumpAgeHours(newest.mtime);
  const size = (newest.size / 1024 / 1024).toFixed(1);
  const age = hours < 1 ? "under an hour" : `${Math.round(hours)}h`;
  if (hours > BACKUP_STALE_HOURS) {
    warn("Backups", `newest is ${age} old (${size} MB), ${dumps.length} kept`, "npm run backup, and check the nightly schedule is actually running.");
  } else {
    ok("Backups", `newest ${age} old, ${size} MB, ${dumps.length} kept`);
  }
}

// ── Database: migrations and version ──────────────────────────────────────────
async function dbChecks() {
  if (!dbUrl) return;
  const { prisma } = await import("../src/lib/prisma");
  try {
    const rows = await prisma.$queryRaw<{ server_version: string }[]>`SHOW server_version`;
    const serverMajor = pgMajor(rows[0].server_version);
    ok("Postgres server", rows[0].server_version);

    if (haveDump && clientMajor && serverMajor) {
      if (!clientCanDump(clientMajor, serverMajor)) {
        block(
          "pg_dump version",
          `client ${clientMajor} cannot dump server ${serverMajor}`,
          `pg_dump refuses a server newer than itself. Install PostgreSQL client ${serverMajor} or newer.`,
        );
      } else {
        ok("pg_dump version", `client ${clientMajor} can dump server ${serverMajor}`);
      }
    }

    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    const appliedSet = new Set(applied.map((a) => a.migration_name));
    const onDisk = readdirSync(path.join(process.cwd(), "prisma", "migrations"))
      .filter((d) => /^\d{14}_/.test(d));
    const pending = onDisk.filter((m) => !appliedSet.has(m));

    if (pending.length) {
      block(
        "Migrations",
        `${pending.length} pending: ${pending.join(", ")}`,
        "npx prisma migrate deploy",
      );
    } else {
      ok("Migrations", `all ${onDisk.length} applied`);
    }
  } catch (e) {
    block("Database", `could not be queried: ${(e as Error).message.split("\n")[0]}`, "Check DATABASE_URL and that the database is reachable.");
  } finally {
    await prisma.$disconnect().catch(() => { });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
function report() {
  const env = process.env.NODE_ENV ?? "development";
  console.log(`\n  Preflight  ·  NODE_ENV=${env}\n`);

  const icon = { block: "BLOCK", warn: " WARN", ok: "   ok" } as const;
  for (const c of checks) {
    console.log(`  ${icon[c.severity]}  ${c.name.padEnd(24)} ${c.detail}`);
    if (c.fix) console.log(`         ${c.fix.split("\n").join("\n         ")}`);
  }

  const blocks = checks.filter((c) => c.severity === "block").length;
  const warns = checks.filter((c) => c.severity === "warn").length;

  if (env !== "production") {
    console.log(
      "\n  Note: NODE_ENV is not production, so two security limits are running loose.\n" +
      "  In production the login throttle tightens from 50 to 8 failures per username\n" +
      "  and OTP requests from 20 to 3 per phone per 15 minutes.",
    );
  }

  console.log(
    blocks === 0
      ? `\n  READY${warns ? ` with ${warns} warning(s)` : ""}. Still not covered by any check:\n` +
      "    - a real logged-in smoke test (register, bill, dispense, discharge)\n" +
      "    - Supabase point-in-time recovery, which lives in their dashboard\n" +
      "    - a restore drill you have actually run\n"
      : `\n  NOT READY: ${blocks} blocker(s)${warns ? `, ${warns} warning(s)` : ""}.\n`,
  );

  process.exit(blocks === 0 ? 0 : 1);
}

dbChecks().then(report);
