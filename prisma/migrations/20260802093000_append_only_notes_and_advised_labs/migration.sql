-- Two records that could not be acted on, made into rows that can.
--
--   1. Admission.notes was ONE mutable string per stay. The evening shift's
--      entry overwrote the morning's, with no author and no timestamp.
--   2. PrescriptionUpload.labsAdvised was newline-joined free text. Nothing
--      turned a doctor's advised test into an order, and nothing could say
--      which advised tests were never ordered.
--
-- Both old columns are LEFT IN PLACE, deprecated. The backfills below are the
-- only copy of that text; keeping the source for one release means a bad
-- backfill can be spotted and re-run instead of discovered after the data is
-- gone. Drop them in a later migration once the rows have been eyeballed.

-- ── 1. Append-only admission notes ──────────────────────────────────────────

CREATE TYPE "AdmissionNoteKind" AS ENUM ('NURSING', 'DISCHARGE');

CREATE TABLE "AdmissionNote" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" "AdmissionNoteKind" NOT NULL DEFAULT 'NURSING',
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdmissionNote_admissionId_createdAt_idx"
    ON "AdmissionNote"("admissionId", "createdAt");

ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_admissionId_fkey"
    FOREIGN KEY ("admissionId") REFERENCES "Admission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdmissionNote" ADD CONSTRAINT "AdmissionNote_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one row per stay that has text. authorId stays NULL because the old
-- column genuinely never recorded who wrote it - the ward list and the printed
-- summary say "author not recorded" rather than inventing a name. createdAt is
-- the admission time, the only timestamp the old shape can honestly supply.
INSERT INTO "AdmissionNote" ("id", "admissionId", "body", "kind", "authorId", "createdAt")
SELECT
    gen_random_uuid()::text,
    "id",
    btrim("notes"),
    'NURSING',
    NULL,
    "admittedAt"
FROM "Admission"
WHERE "notes" IS NOT NULL AND btrim("notes") <> '';

-- ── 2. Advised labs as rows ─────────────────────────────────────────────────

CREATE TABLE "PrescriptionUploadLab" (
    "id" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "catalogId" TEXT,
    "labTestId" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declinedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionUploadLab_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrescriptionUploadLab_labTestId_key"
    ON "PrescriptionUploadLab"("labTestId");
CREATE INDEX "PrescriptionUploadLab_uploadId_idx"
    ON "PrescriptionUploadLab"("uploadId");
CREATE INDEX "PrescriptionUploadLab_labTestId_idx"
    ON "PrescriptionUploadLab"("labTestId");

ALTER TABLE "PrescriptionUploadLab" ADD CONSTRAINT "PrescriptionUploadLab_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "PrescriptionUpload"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PrescriptionUploadLab" ADD CONSTRAINT "PrescriptionUploadLab_catalogId_fkey"
    FOREIGN KEY ("catalogId") REFERENCES "LabTestCatalog"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PrescriptionUploadLab" ADD CONSTRAINT "PrescriptionUploadLab_labTestId_fkey"
    FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: split the newline-joined text into one row per advised test, and
-- resolve each against the lab master by exact case-insensitive name. Anything
-- that does not match keeps catalogId NULL - it still prints, it just cannot be
-- ordered in one click, which is the truth about a test the catalog does not
-- stock. labTestId is left NULL throughout: we do NOT guess that a historic
-- LabTest fulfilled a historic line of advice, because a wrong link would read
-- as "this was done" when it may not have been.
INSERT INTO "PrescriptionUploadLab" ("id", "uploadId", "testName", "catalogId", "labTestId", "createdAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    btrim(line.value),
    c."id",
    NULL,
    u."createdAt"
FROM "PrescriptionUpload" u
CROSS JOIN LATERAL unnest(string_to_array(u."labsAdvised", E'\n')) AS line(value)
LEFT JOIN "LabTestCatalog" c
    ON lower(btrim(c."name")) = lower(btrim(line.value))
   AND c."active" = true
WHERE u."labsAdvised" IS NOT NULL
  AND btrim(line.value) <> '';
