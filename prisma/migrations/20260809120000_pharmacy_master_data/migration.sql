-- PHARMACY MASTER DATA - the vocabularies a medicine is described in.
--
-- Until now a medicine's generic, manufacturer, dosage form and HSN were free
-- text typed into the product row. That works until the catalogue outgrows a
-- page, at which point "Cipla", "CIPLA" and "Cipla Ltd" are three manufacturers
-- to a GROUP BY and one to a human, "what else has this salt in it" cannot be
-- answered at all, and the GST rate on the product has no connection to the HSN
-- it is filed under.
--
-- WHAT THIS MIGRATION DOES NOT DO, deliberately:
--
--   It does not replace Medicine. There is still exactly one product model and
--   exactly one Supplier model; these are lookups they point at.
--
--   It does not drop or alter a single existing column. Every free-text field
--   stays, still populated and still read - the new FKs are all NULLABLE and
--   the services fall back to the strings wherever a link is not yet set. A
--   catalogue can therefore be linked up one row at a time, by whoever knows
--   the answer, instead of in one migration that would have to guess.
--
--   It does not touch stock, batches, purchases or invoices. Nothing about what
--   is on the shelf or what has been sold is changed by this.
--
--   It populates NOTHING. In particular DrugSchedule ships EMPTY and
--   Medicine.scheduleId stays null: whether a molecule is Schedule H1 is a
--   regulatory fact about a specific product, and guessing it from a name would
--   either impose a register the pharmacy does not need or - far worse - fail
--   to impose one it does, behind software that looked authoritative.
--
-- Every statement below is additive: CREATE TABLE, ADD COLUMN (nullable),
-- CREATE INDEX, ADD CONSTRAINT. There is no DROP, no TRUNCATE and no DELETE.
-- Foreign keys are ON DELETE SET NULL, so retiring a master row unlinks the
-- products that used it rather than deleting them.

-- AlterTable
ALTER TABLE "Medicine" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "dosageFormId" TEXT,
ADD COLUMN     "genericId" TEXT,
ADD COLUMN     "hsnId" TEXT,
ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "taxRateId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "MedicineCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicineCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DosageForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DosageForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratePct" DECIMAL(4,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HsnCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "defaultTaxRateId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HsnCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugSchedule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT true,
    "retentionYears" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicineCategory_name_key" ON "MedicineCategory"("name");

-- CreateIndex
CREATE INDEX "MedicineCategory_active_name_idx" ON "MedicineCategory"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Generic_name_key" ON "Generic"("name");

-- CreateIndex
CREATE INDEX "Generic_active_name_idx" ON "Generic"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_name_key" ON "Manufacturer"("name");

-- CreateIndex
CREATE INDEX "Manufacturer_active_name_idx" ON "Manufacturer"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DosageForm_name_key" ON "DosageForm"("name");

-- CreateIndex
CREATE INDEX "DosageForm_active_name_idx" ON "DosageForm"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_name_key" ON "UnitOfMeasure"("name");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_active_name_idx" ON "UnitOfMeasure"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_name_key" ON "TaxRate"("name");

-- CreateIndex
CREATE INDEX "TaxRate_active_ratePct_idx" ON "TaxRate"("active", "ratePct");

-- CreateIndex
CREATE UNIQUE INDEX "HsnCode_code_key" ON "HsnCode"("code");

-- CreateIndex
CREATE INDEX "HsnCode_active_code_idx" ON "HsnCode"("active", "code");

-- CreateIndex
CREATE INDEX "HsnCode_defaultTaxRateId_idx" ON "HsnCode"("defaultTaxRateId");

-- CreateIndex
CREATE UNIQUE INDEX "DrugSchedule_code_key" ON "DrugSchedule"("code");

-- CreateIndex
CREATE INDEX "DrugSchedule_active_code_idx" ON "DrugSchedule"("active", "code");

-- CreateIndex
CREATE INDEX "Medicine_categoryId_idx" ON "Medicine"("categoryId");

-- CreateIndex
CREATE INDEX "Medicine_genericId_idx" ON "Medicine"("genericId");

-- CreateIndex
CREATE INDEX "Medicine_manufacturerId_idx" ON "Medicine"("manufacturerId");

-- CreateIndex
CREATE INDEX "Medicine_dosageFormId_idx" ON "Medicine"("dosageFormId");

-- CreateIndex
CREATE INDEX "Medicine_unitId_idx" ON "Medicine"("unitId");

-- CreateIndex
CREATE INDEX "Medicine_hsnId_idx" ON "Medicine"("hsnId");

-- CreateIndex
CREATE INDEX "Medicine_taxRateId_idx" ON "Medicine"("taxRateId");

-- CreateIndex
CREATE INDEX "Medicine_scheduleId_idx" ON "Medicine"("scheduleId");

-- AddForeignKey
ALTER TABLE "HsnCode" ADD CONSTRAINT "HsnCode_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MedicineCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_genericId_fkey" FOREIGN KEY ("genericId") REFERENCES "Generic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_dosageFormId_fkey" FOREIGN KEY ("dosageFormId") REFERENCES "DosageForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_hsnId_fkey" FOREIGN KEY ("hsnId") REFERENCES "HsnCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medicine" ADD CONSTRAINT "Medicine_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "DrugSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

