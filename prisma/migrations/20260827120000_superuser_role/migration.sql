-- The developers' role. Additive only: ALTER TYPE ... ADD VALUE appends to the
-- enum without rewriting a single row, so nothing that exists changes meaning
-- and no table is locked. That matters here more than usual - this runs against
-- the hospital's live database, the one reception is billing on, because there
-- is no staging copy to rehearse it against.
--
-- Postgres 12+ allows ADD VALUE inside a transaction as long as the new value
-- is not USED in the same transaction. This migration only declares it; the
-- accounts that carry it are written afterwards by prisma/seed-dev.ts.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPERUSER';
