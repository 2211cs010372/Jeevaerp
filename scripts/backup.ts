/**
 * Take a full logical backup of the hospital database.
 *
 *   npm run backup
 *
 * WHY THIS EXISTS WHEN SUPABASE ALREADY BACKS UP. Supabase's own backups and
 * point-in-time recovery are the primary protection and this script does not
 * replace them: PITR is what gets you back after a bad DELETE at 4 PM. What PITR
 * cannot survive is losing the account itself - a billing lapse, a deleted
 * project, a compromised login, a decision to change provider. This produces an
 * INDEPENDENT copy that lives wherever you put it and restores into any Postgres.
 *
 * Read-only against the database. It cannot damage anything.
 *
 * The output is a complete copy of every patient record in the hospital. Treat
 * the file as you would the ward's paper case notes: /backups is gitignored,
 * keep the off-machine copy encrypted, and do not park it in a Downloads folder.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { backupFilename, planRotation, parsePgUrl } from "../src/lib/backup";

/**
 * Next.js reads .env for you; a plain tsx script does not, so DIRECT_URL was
 * invisible here and the script reported "no DIRECT_URL" on a machine that had
 * one. process.loadEnvFile is built into Node 22, which keeps this dependency-free
 * (dotenv is only present transitively and could vanish on any install).
 * A real environment - CI, a container, Task Scheduler - has no .env file and
 * passes the variables directly, so a missing file is not an error.
 */
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* no .env: variables are expected to come from the environment itself */
}

const OUT_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");
const KEEP = Number(process.env.BACKUP_KEEP || 14);

function die(msg: string, hint?: string): never {
  console.error(`\n  backup failed: ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
}

// pg_dump needs a session connection. DATABASE_URL points at pgbouncer in
// transaction pooling mode, which does not implement the statements pg_dump
// issues, so a dump taken through it fails or comes back subtly incomplete.
// DIRECT_URL is the same database on the session port and is the correct source.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) die("no DIRECT_URL or DATABASE_URL in the environment", "Set DIRECT_URL in .env (see .env.example).");
if (!process.env.DIRECT_URL) {
  console.warn(
    "  warning: DIRECT_URL is not set, falling back to DATABASE_URL.\n" +
    "  If that is the pooled (pgbouncer) connection this dump may fail or be incomplete.",
  );
}

const target = parsePgUrl(url!);
if (!target) die("DIRECT_URL is not a valid postgres:// URL");

const probe = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  die(
    "pg_dump is not on PATH",
    "Install the PostgreSQL client tools, matching your server's major version:\n" +
    "    Windows  winget install PostgreSQL.PostgreSQL.17   (then reopen the terminal)\n" +
    "    macOS    brew install libpq && brew link --force libpq\n" +
    "    Debian   sudo apt install postgresql-client-17",
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, backupFilename());

console.log(`  source  ${target!.host}:${target!.port}/${target!.database}`);
console.log(`  target  ${outFile}`);
console.log(`  pg_dump ${probe.stdout.trim()}`);
console.log("  dumping…");

const started = Date.now();
// --format=custom: compressed, and pg_restore can then pull single tables out of
// it, which is what you want at 3 AM when only one table is wrong.
// --no-owner / --no-privileges: the dump has to restore into a scratch database
// owned by a different role, which is exactly what the restore drill does.
const dump = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", outFile, url!],
  { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] },
);

if (dump.status !== 0) {
  if (existsSync(outFile)) rmSync(outFile, { force: true }); // never leave a half file that looks like a backup
  die(`pg_dump exited ${dump.status}`, (dump.stderr || "").trim());
}

const bytes = statSync(outFile).size;
// A custom-format dump of an empty schema is still a few KB, so anything this
// small means the dump did not capture the database and must not be counted as
// a backup. Exiting non-zero is what makes cron notice.
if (bytes < 20_000) {
  rmSync(outFile, { force: true });
  die(
    `dump was only ${bytes} bytes, which is too small to be this database`,
    "Check that DIRECT_URL points at the hospital database and not an empty one.",
  );
}

const { remove } = planRotation(readdirSync(OUT_DIR), KEEP);
for (const f of remove) rmSync(path.join(OUT_DIR, f), { force: true });

const mb = (bytes / 1024 / 1024).toFixed(1);
const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n  done    ${mb} MB in ${secs}s`);
if (remove.length) console.log(`  pruned  ${remove.length} older dump(s), keeping ${KEEP}`);
console.log(
  "\n  This file is the whole hospital. Copy it somewhere off this machine,\n" +
  "  encrypted, then prove it restores:  npm run backup:verify -- --file " + outFile + " --target <scratch-url>\n",
);
