/**
 * Prove a backup actually restores, and time how long it takes.
 *
 *   npm run backup:verify -- --file backups/jeeva-....dump --target postgresql://…/jeeva_restore_test
 *
 * An untested backup is not a backup. This is the drill that turns the file into
 * a number you can put in front of the hospital: "we can be back in N minutes."
 * Run it once before go-live, then quarterly, and write the number into
 * docs/runbook-restore.md.
 *
 * DESTRUCTIVE TO ITS TARGET. It drops and recreates every object in --target.
 * That is the point: a restore into a database that already has the tables is not
 * the restore you will be doing at 3 AM. Because of that it refuses to run
 * against the database in DIRECT_URL/DATABASE_URL, and it makes you type a flag
 * that says out loud what is about to happen.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { isSameDatabase, parsePgUrl } from "../src/lib/backup";

/**
 * Load .env before the production-target guard runs. This is not convenience: the
 * guard compares --target against DIRECT_URL and DATABASE_URL, and if those are
 * not in the environment it has nothing to compare and would happily restore over
 * the live hospital database. Silent success is the failure mode, so the check
 * below refuses to run when neither variable is present.
 */
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  /* no .env: variables are expected to come from the environment itself */
}

function die(msg: string, hint?: string): never {
  console.error(`\n  verify failed: ${msg}`);
  if (hint) console.error(`  ${hint}`);
  console.error("");
  process.exit(1);
}

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const file = arg("file");
const target = arg("target");
const confirmed = args.includes("--yes-wipe-the-target");

if (!file || !target) {
  die(
    "need --file and --target",
    "npm run backup:verify -- --file backups/jeeva-….dump --target postgresql://…/jeeva_restore_test",
  );
}
if (!existsSync(file!)) die(`no such file: ${file}`);

const t = parsePgUrl(target!);
if (!t) die("--target is not a valid postgres:// URL");

// The guard that matters. isSameDatabase fails closed on anything it cannot
// parse, so a mangled production URL in the environment blocks the run rather
// than silently comparing unequal and letting the restore proceed.
//
// No production URL at all is the worse case: the loop below would find nothing
// to compare and wave the restore through. An empty environment means the guard
// is not armed, so refuse rather than pretend it passed.
if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  die(
    "neither DIRECT_URL nor DATABASE_URL is set, so the production-target check cannot run",
    "Run this from the project root with a .env present, so the script can prove\n" +
    "  --target is not the live hospital database.",
  );
}

for (const [name, live] of [
  ["DIRECT_URL", process.env.DIRECT_URL],
  ["DATABASE_URL", process.env.DATABASE_URL],
] as const) {
  if (live && isSameDatabase(live, target!)) {
    die(
      `--target is the same database as ${name}`,
      "This would destroy the live hospital data. Create a separate empty database\n" +
      "  and point --target at that instead.",
    );
  }
}

if (!confirmed) {
  die(
    "refusing to wipe a database without an explicit go-ahead",
    `Every object in ${t!.host}:${t!.port}/${t!.database} will be dropped and rebuilt.\n` +
    "  If that is a scratch database, add:  --yes-wipe-the-target",
  );
}

for (const bin of ["pg_restore", "psql"]) {
  const probe = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    die(`${bin} is not on PATH`, "Install the PostgreSQL client tools (see scripts/backup.ts).");
  }
}

const mb = (statSync(file!).size / 1024 / 1024).toFixed(1);
console.log(`  dump    ${file} (${mb} MB)`);
console.log(`  into    ${t!.host}:${t!.port}/${t!.database}`);
console.log("  restoring…\n");

const started = Date.now();
// --clean --if-exists: drop what is there first, so this measures a real restore
// rather than an insert into empty tables.
// --no-owner / --no-privileges: the scratch database is owned by another role.
// pg_restore exits non-zero on harmless notices, so the row counts below are the
// real pass/fail signal, not the exit code alone.
const restore = spawnSync(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", target!, file!],
  { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] },
);
const elapsed = (Date.now() - started) / 1000;

const stderr = (restore.stderr || "").trim();
if (restore.status !== 0 && stderr) {
  console.warn("  pg_restore reported:\n" + stderr.split("\n").slice(0, 15).map((l) => "    " + l).join("\n"));
  console.warn("  (notices are normal on a --clean restore into an empty database)\n");
}

// The actual verdict. A restore that "succeeded" into empty tables is the
// failure mode this drill exists to catch, so ask the database what it holds.
const TABLES = ["Patient", "Appointment", "Invoice", "Payment", "Admission", "Medicine", "User"];
const sql = TABLES.map((t2) => `SELECT '${t2}' AS t, COUNT(*) AS n FROM "${t2}"`).join(" UNION ALL ");
const counts = spawnSync("psql", ["--no-psqlrc", "--tuples-only", "--no-align", "--field-separator=|", "-c", sql, target!], {
  encoding: "utf8",
});

if (counts.status !== 0) {
  die("restored, but the tables could not be read back", (counts.stderr || "").trim());
}

const rows = (counts.stdout || "")
  .trim()
  .split("\n")
  .map((l) => l.split("|"))
  .filter((p) => p.length === 2)
  .map(([t2, n]) => [t2.trim(), Number(n)] as [string, number]);

console.log("  restored row counts");
for (const [t2, n] of rows) console.log(`    ${t2.padEnd(14)} ${n}`);

const empty = rows.filter(([, n]) => n === 0).map(([t2]) => t2);
const total = rows.reduce((s, [, n]) => s + n, 0);

console.log(`\n  RTO     ${elapsed.toFixed(1)}s to restore ${mb} MB`);

if (total === 0) {
  die(
    "every table restored empty - this dump does not contain the data",
    "Do not count this file as a backup. Re-run npm run backup and check DIRECT_URL.",
  );
}
if (empty.length) {
  console.warn(`\n  note    empty after restore: ${empty.join(", ")}`);
  console.warn("          fine if the hospital genuinely has none of these yet, otherwise investigate.");
}

console.log(
  `\n  PASS    backup restores and holds ${total} rows across ${rows.length} core tables.\n` +
  `          Write the RTO (${elapsed.toFixed(1)}s for ${mb} MB) into docs/runbook-restore.md.\n`,
);
