-- THE NIGHTLY REPORT TO THE OWNERS - who gets it, and whether it goes at all.
--
-- Three columns, all additive, all with defaults or nullable, so this migration
-- rewrites no existing row and cannot fail on data. It is safe to run against
-- the live database while staff are billing.
--
-- ── WHY THE LIST IS NOT ONLY AN ENV VAR ──
--
-- The recipients change for business reasons - a partner joins, an accountant
-- leaves - and if changing them needs a developer and a redeploy, the list goes
-- stale and somebody who left the hospital keeps receiving its daily takings.
-- So the list lives here, editable on the admin settings screen with a name
-- against every change in the audit log. REPORT_EMAILS and
-- REPORT_WHATSAPP_NUMBERS in the environment stay as the fallback for whichever
-- list is still blank, which is also what keeps the report working in the
-- window between this migration and the first time anybody opens that screen.
--
-- ── DEFAULT TRUE IS DELIBERATE ──
--
-- A hospital that never opens the settings page should still hear from its own
-- ERP. With no recipients configured anywhere the send is skipped as
-- "no-recipients" and nothing is mailed, so the default cannot leak anything -
-- it only decides what happens once somebody has entered an address.

-- AlterTable
ALTER TABLE "HospitalConfig" ADD COLUMN     "dailyReportEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reportEmails" TEXT,
ADD COLUMN     "reportWhatsappNumbers" TEXT;
