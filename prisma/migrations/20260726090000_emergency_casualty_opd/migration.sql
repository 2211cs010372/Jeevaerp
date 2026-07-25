-- Emergency / Casualty OP.
--
-- A patient carried into casualty at 2 AM is seen by whoever is on duty. There
-- is no appointment, no slot and often no named doctor at the moment the desk
-- has to issue an OP number. Two changes make that a first-class visit instead
-- of a workaround:
--
--   1. Two new visit types, so emergency footfall is countable and the printed
--      sheet can be classified.
--   2. Appointment.doctorId becomes nullable - the visit exists before the
--      consultant does. slotId was already nullable (cancellation releases it).
--
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+ as long as
-- the new label is not USED in the same transaction; nothing below uses it.

ALTER TYPE "AppointmentType" ADD VALUE IF NOT EXISTS 'EMERGENCY';
ALTER TYPE "AppointmentType" ADD VALUE IF NOT EXISTS 'CASUALTY';

-- DropForeignKey / re-add is not needed: only the column's nullability changes,
-- the FK itself is unchanged.
ALTER TABLE "Appointment" ALTER COLUMN "doctorId" DROP NOT NULL;

-- Emergency visits are pulled by type constantly (today's casualty list, the
-- monthly emergency count). Without this the queue falls back to the visitDate
-- index and filters in memory.
CREATE INDEX IF NOT EXISTS "Appointment_visitDate_type_idx" ON "Appointment"("visitDate", "type");
