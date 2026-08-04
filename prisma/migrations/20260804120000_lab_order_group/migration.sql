-- ONE ORDER, NOT N ROWS.
--
-- Picking a CBP, an LFT and a TSH for the same patient wrote three LabTest
-- rows with nothing tying them together. The bench queue therefore showed three
-- separate jobs for one tube, and the only way to tell they belonged to the
-- same person was to read the name on each row.
--
-- orderGroupId is that tie: one value per submit, shared by every test raised
-- in it. The rows stay separate on purpose - each test has its own analytes,
-- its own price, its own completion and its own report - but the queue can now
-- draw them as the single job they are.

ALTER TABLE "LabTest" ADD COLUMN "orderGroupId" TEXT;

-- Backfill. Tests that were ordered together were written by one loop inside
-- one transaction, so they share a patient (or a visit, or a stay) and land
-- within the same second. That is the strongest signal available after the
-- fact, and grouping on it is safe in the only direction that matters: the
-- worst case is two orders raised for the same patient in the same second
-- reading as one, which is what they looked like at the counter anyway.
--
-- Tests with no patient AND no appointment are left alone below - there is
-- nothing to group them by, and every one of them becomes an order of one.
WITH grouped AS (
    SELECT
        id,
        FIRST_VALUE("id") OVER (
            PARTITION BY
                COALESCE("patientId", ''),
                COALESCE("appointmentId", ''),
                COALESCE("admissionId", ''),
                DATE_TRUNC('second', "createdAt")
            ORDER BY "id"
        ) AS group_id
    FROM "LabTest"
    WHERE "patientId" IS NOT NULL OR "appointmentId" IS NOT NULL
)
UPDATE "LabTest" t
SET "orderGroupId" = g.group_id
FROM grouped g
WHERE t."id" = g."id";

CREATE INDEX "LabTest_orderGroupId_idx" ON "LabTest"("orderGroupId");
