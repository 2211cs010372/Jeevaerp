-- THE STAY'S DISCHARGE SUMMARY - one record, two desks.
--
-- Until now this document was DERIVED at read time from admission notes,
-- prescription uploads and lab rows. That covers the half a machine can know -
-- who the patient is, what was dispensed, which tests ran - and none of the half
-- only a doctor can write. There was nowhere in this schema to put a history of
-- presenting illness, a course in hospital, or a condition at discharge.
--
-- ONE ROW PER ADMISSION, enforced by the UNIQUE index below rather than by
-- convention. Reception and the insurance desk both write this document, and
-- "two portals, one record" only stays true if the database says so - otherwise
-- it grows a second summary a month later and nobody can say which one the
-- patient was actually given.
--
-- STORES ONLY WHAT SOMEBODY TYPES. Patient name, UHID, ward, bed, consultant,
-- insurer, medicines and investigations are all reachable through admissionId
-- and are deliberately not copied here.
--
-- The examination fields are TEXT and not numeric on purpose: real summaries
-- record "Afbrile", "98% ON RA", "S1, S2(+)", "WFND". A numeric column makes the
-- commonest true entries unstorable.
--
-- Additive: one new enum, one new table, four foreign keys. No existing table is
-- altered, nothing is backfilled, and no data is read or moved.

-- CreateEnum
CREATE TYPE "DischargeSummaryStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "DischargeSummary" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "status" "DischargeSummaryStatus" NOT NULL DEFAULT 'DRAFT',
    "diagnosis" TEXT,
    "historyPresenting" TEXT,
    "pastPersonalHistory" TEXT,
    "clinicalFindings" TEXT,
    "physicalExamination" TEXT,
    "systemicExamination" TEXT,
    "courseInHospital" TEXT,
    "procedureNotes" TEXT,
    "conditionAtDischarge" TEXT,
    "followUpInstruction" TEXT,
    "preventiveAdvice" TEXT,
    "vitalTemp" TEXT,
    "vitalPulse" TEXT,
    "vitalBp" TEXT,
    "vitalSpo2" TEXT,
    "examCvs" TEXT,
    "examRs" TEXT,
    "examPa" TEXT,
    "examCns" TEXT,
    "followUpDate" DATE,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DischargeSummary_pkey" PRIMARY KEY ("id")
);

-- One summary per stay. This index IS the "single source of truth" rule.
-- CreateIndex
CREATE UNIQUE INDEX "DischargeSummary_admissionId_key" ON "DischargeSummary"("admissionId");

-- CreateIndex
CREATE INDEX "DischargeSummary_status_idx" ON "DischargeSummary"("status");

-- AddForeignKey
ALTER TABLE "DischargeSummary" ADD CONSTRAINT "DischargeSummary_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The author is never nulled: a summary with no recorded author is a
-- medico-legal document nobody signed.
-- AddForeignKey
ALTER TABLE "DischargeSummary" ADD CONSTRAINT "DischargeSummary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeSummary" ADD CONSTRAINT "DischargeSummary_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DischargeSummary" ADD CONSTRAINT "DischargeSummary_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
