-- ADMIN-CONTROLLED SETTINGS.
--
-- Things that were previously decided in source code and therefore could only be
-- changed by a developer: the logo, the brand name, how far ahead a pharmacy
-- batch counts as "expiring soon", whether an unpaid ward bill blocks a
-- discharge, and whether the public site may take bookings at all.
--
-- Every column carries the value that was hardcoded before it, so applying this
-- changes nothing about how the system behaves until an admin decides otherwise.
-- A settings migration that quietly alters behaviour on deploy is how a hospital
-- discovers on a Monday morning that discharges stopped working.

ALTER TABLE "HospitalConfig" ADD COLUMN "logoDataUrl"             TEXT;
ALTER TABLE "HospitalConfig" ADD COLUMN "brandName"               TEXT    NOT NULL DEFAULT 'Jeeva';
ALTER TABLE "HospitalConfig" ADD COLUMN "tagline"                 TEXT;
ALTER TABLE "HospitalConfig" ADD COLUMN "invoiceFooterNote"       TEXT;
ALTER TABLE "HospitalConfig" ADD COLUMN "expiryAlertDays"         INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "HospitalConfig" ADD COLUMN "blockDischargeOnDues"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HospitalConfig" ADD COLUMN "onlineBookingEnabled"    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HospitalConfig" ADD COLUMN "callbackRequestsEnabled" BOOLEAN NOT NULL DEFAULT true;

-- An alert window of 0 days means "never warn me", which is indistinguishable
-- from the feature being broken. A negative one would look backwards in time.
ALTER TABLE "HospitalConfig" ADD CONSTRAINT "HospitalConfig_expiryAlertDays_sane"
  CHECK ("expiryAlertDays" >= 1 AND "expiryAlertDays" <= 730);
