import { prisma } from "./prisma";
import type { Prisma } from "@prisma/client";
import { formatId, type IdKind } from "./id-formats";

/**
 * Sequential human-facing IDs. The shapes - and the reasoning behind them - live
 * in ./id-formats.ts, which is pure and tested. This file is only the counter.
 */
export { formatId, type IdKind };

/**
 * Race-safe sequential ID generation.
 *
 * The insert-or-increment happens in ONE SQL statement, so two receptionists
 * registering patients in the same millisecond can never receive the same
 * number - Postgres serializes the row update internally.
 *
 * Pass `tx` to enrol the counter bump in a surrounding transaction (so an ID
 * is never burned if the operation that needed it rolls back).
 */
export async function nextId(
  kind: IdKind,
  opts: { year?: number; tx?: Prisma.TransactionClient } = {}
): Promise<string> {
  const year = opts.year ?? new Date().getFullYear();
  const db = opts.tx ?? prisma;
  const key = `${kind}-${year}`;
  const rows = await db.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("key", "value")
    VALUES (${key}, 1)
    ON CONFLICT ("key")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  return formatId(kind, year, rows[0].value);
}
