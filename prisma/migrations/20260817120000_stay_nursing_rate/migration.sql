-- WHAT NURSING COSTS PER DAY, ON THIS STAY.
--
-- It was a constant in ipd.service (₹600/day), applied to the running tab, the
-- discharge invoice and the claim bill alike. That is right as a default and
-- wrong as the only answer: an insurer settles nursing at its own tariff, a
-- long stay gets it waived, and neither could be recorded anywhere. The desk's
-- workaround was to add a negative "adjustment" line to the tab, which reads on
-- a claim as the hospital correcting its own bill.
--
-- PER-ADMISSION, like dailyChargeAtAdmit beside it, and for the same reason:
-- raising the standard fee must never reach back and re-price a stay that has
-- already been billed.
--
-- NULLABLE, so there is no backfill and no behaviour change: NULL means "nobody
-- has corrected this one" and the service falls back to the constant exactly as
-- it does today. Only a stay somebody deliberately corrected carries a number.

-- AlterTable
ALTER TABLE "Admission" ADD COLUMN     "nursePerDay" DECIMAL(10,2);
