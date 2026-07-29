-- CASE HISTORY (doctor) and LAB IMPRESSION (bench).
--
-- Two free-text columns, both nullable, both additive. Nothing that exists
-- today changes behaviour when this is applied: a record written before this
-- migration simply has NULL in both, and every screen already treats a missing
-- clinical field as "not written yet".
--
-- They are deliberately SEPARATE columns on separate tables, not one shared
-- "notes" field:
--
--   PrescriptionUpload.caseHistory  is the doctor's - presenting complaints and
--   history for one visit, and it prints in the Case history block at the top
--   of the OPD sheet.
--
--   LabTest.impression              is the lab's, written by the technician
--   against the numbers of ONE test as they are saved. It is the lab's read of
--   its own specimen, not the patient's diagnosis, and it must never be able to
--   overwrite the doctor's line - which is why it does not live on the
--   prescription row at all.

ALTER TABLE "PrescriptionUpload" ADD COLUMN "caseHistory" TEXT;
ALTER TABLE "LabTest"            ADD COLUMN "impression"  TEXT;
