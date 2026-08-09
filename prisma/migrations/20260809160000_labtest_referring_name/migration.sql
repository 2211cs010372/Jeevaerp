-- A REFERRER WHO IS NOT A DOCTOR ON THIS ROSTER.
--
-- LabTest.referringDoctorId is a foreign key, so the only referrer a lab order
-- could name was somebody who works here. The hospital itself refers samples -
-- a ward sends one down, a camp collects one, the desk takes one against the
-- hospital's own name - and every one of those printed "Ref. Doctor: Self /
-- walk-in", which tells the reader the patient turned up off the street.
--
-- Text, not a second relation, because there is nothing to relate to: this is a
-- name on a printed line, not an entity anyone rosters, schedules or pays.
-- Creating a Doctor row called "Jeeva Multispeciality Hospital" would have put
-- it into every booking dropdown, every schedule and the doctor portal.
--
-- Additive and nullable. Nothing is backfilled: an existing order that printed
-- "Self / walk-in" was either genuinely self-referred or was missing its
-- referrer already, and this migration cannot tell which.

-- AlterTable
ALTER TABLE "LabTest" ADD COLUMN     "referringName" TEXT;
