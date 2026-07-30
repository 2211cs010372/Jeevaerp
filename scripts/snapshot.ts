/**
 * Dumps every table to one timestamped JSON file, using Prisma alone.
 *
 *   npm run snapshot
 *
 * This is NOT a replacement for `npm run backup`. pg_dump captures the schema,
 * sequences, indexes and constraints; this captures ROWS and nothing else. It
 * exists because pg_dump needs the Postgres client tools installed, and a
 * destructive operation should never be gated on that - a data snapshot taken in
 * ten seconds beats a perfect backup nobody took.
 *
 * The schema is already reproducible from prisma/migrations, so rows are the part
 * that is genuinely unrecoverable. Together they are a real recovery path:
 *
 *   npx prisma migrate deploy      # rebuild the schema
 *   <restore rows from the JSON>   # in dependency order
 *
 * Tables are dumped in the order the Prisma schema declares them. Restoring needs
 * parents before children, so a restore is not a blind replay - read the file and
 * insert deliberately.
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

/** Decimal, Date and BigInt are not JSON. Keep full precision as strings. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toFixed" in value && typeof (value as { toFixed: unknown }).toFixed === "function") {
    return (value as { toString(): string }).toString();
  }
  return value;
}

async function main() {
  const dir = path.join(process.cwd(), "backups");
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `snapshot-${stamp}.json`);

  const out: Record<string, unknown[]> = {};
  let total = 0;

  // Driven off the generated datamodel rather than a hand-written list, so a
  // model added later is captured without anyone remembering to edit this file.
  for (const model of Prisma.dmmf.datamodel.models) {
    const delegate = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    const client = (prisma as unknown as Record<string, { findMany?: () => Promise<unknown[]> }>)[delegate];
    if (!client?.findMany) continue;
    const rows = await client.findMany();
    out[model.name] = rows;
    total += rows.length;
    if (rows.length) console.log(`     ${model.name.padEnd(24)} ${rows.length}`);
  }

  writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), tables: out }, replacer, 2), "utf8");

  const sizeMb = (Buffer.byteLength(JSON.stringify(out, replacer)) / 1_048_576).toFixed(2);
  console.log(`\n  ✓ ${total} rows across ${Object.keys(out).length} tables -> ${file} (${sizeMb} MB)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
