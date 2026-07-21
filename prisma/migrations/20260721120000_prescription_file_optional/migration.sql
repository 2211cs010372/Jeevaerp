-- Typed prescriptions are data-only (no generated PDF); only genuine scanned
-- uploads carry a file. Make the file columns nullable.
ALTER TABLE "PrescriptionUpload" ALTER COLUMN "fileUrl" DROP NOT NULL;
ALTER TABLE "PrescriptionUpload" ALTER COLUMN "fileName" DROP NOT NULL;
ALTER TABLE "PrescriptionUpload" ALTER COLUMN "mimeType" DROP NOT NULL;
ALTER TABLE "PrescriptionUpload" ALTER COLUMN "fileSize" DROP NOT NULL;
