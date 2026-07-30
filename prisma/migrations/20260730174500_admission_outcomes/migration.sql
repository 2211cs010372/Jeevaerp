-- ADMISSION OUTCOMES: a stay can end in the four ways it actually ends.
--
-- AdmissionStatus was ADMITTED | DISCHARGED. A 50-bed hospital hits LAMA, an
-- absconded patient, a transfer out and a death every month, and none of them
-- could be recorded. So a death was filed as a discharge, because that was the
-- only value the software would accept. Once staff learn to enter something
-- untrue to make the system take reality, every number downstream - the day
-- close, the discharge count, anything a medico-legal reader is shown - is
-- fiction, and nobody can tell which rows are the lies.
--
-- WHY THIS IS WORTH DOING BEFORE GO-LIVE AND NOT AFTER. This is a one-way door.
-- Adding the values is cheap now and free of backfill. Doing it after a year of
-- production means a pile of rows marked DISCHARGED that were really deaths and
-- absconds, with nothing in the data to tell them apart and nobody left who
-- remembers.
--
-- LAMA vs ABSCONDED is not pedantry. LAMA means the patient signed a form
-- accepting the risk. ABSCONDED means nobody obtained consent because nobody knew
-- they were leaving. Recording the second as the first claims a signature that
-- does not exist, which is the one thing you must not do on a medico-legal record.
--
-- ONE OPEN STATE, FOUR CLOSED ONES. Every liveness check in the app asks
-- `status = 'ADMITTED'` or `<> 'ADMITTED'`, so new closed states cannot reopen a
-- closed stay. The queries that had to change are the ones reporting on
-- CLOSURES, which matched 'DISCHARGED' alone: recentDischarges and ipdStats.
--
-- Additive. Existing rows keep their value and no backfill runs: every stay
-- closed before today stays DISCHARGED, which is the only honest thing to say
-- about it now.
--
-- Postgres cannot ALTER TYPE ... ADD VALUE inside a transaction block that later
-- uses the new value. Prisma runs each migration in its own transaction and this
-- file only adds values, using none of them, so it is safe as written.

-- AlterEnum
ALTER TYPE "AdmissionStatus" ADD VALUE 'LAMA';
ALTER TYPE "AdmissionStatus" ADD VALUE 'ABSCONDED';
ALTER TYPE "AdmissionStatus" ADD VALUE 'TRANSFERRED_OUT';
ALTER TYPE "AdmissionStatus" ADD VALUE 'EXPIRED';
