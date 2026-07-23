-- Structured lab results: analyte templates per catalogued test, and the
-- measured lines on a finished test. Purely additive - no existing table is
-- altered and no data is touched.

-- CreateEnum
CREATE TYPE "LabResultFlag" AS ENUM ('NORMAL', 'HIGH', 'LOW', 'ABNORMAL');

-- CreateTable
CREATE TABLE "LabAnalyte" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "refLow" DECIMAL(12,4),
    "refHigh" DECIMAL(12,4),
    "refText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LabAnalyte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResultItem" (
    "id" TEXT NOT NULL,
    "labTestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "value" TEXT NOT NULL,
    "valueNum" DECIMAL(12,4),
    "refLow" DECIMAL(12,4),
    "refHigh" DECIMAL(12,4),
    "refText" TEXT,
    "flag" "LabResultFlag" NOT NULL DEFAULT 'NORMAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabResultItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabAnalyte_catalogId_sortOrder_idx" ON "LabAnalyte"("catalogId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LabAnalyte_catalogId_name_key" ON "LabAnalyte"("catalogId", "name");

-- CreateIndex
CREATE INDEX "LabResultItem_labTestId_sortOrder_idx" ON "LabResultItem"("labTestId", "sortOrder");

-- AddForeignKey
ALTER TABLE "LabAnalyte" ADD CONSTRAINT "LabAnalyte_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "LabTestCatalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultItem" ADD CONSTRAINT "LabResultItem_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
