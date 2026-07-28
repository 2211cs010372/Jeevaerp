-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyerAddress" TEXT,
ADD COLUMN     "buyerGstin" TEXT,
ADD COLUMN     "buyerLegalName" TEXT,
ADD COLUMN     "buyerStateCode" TEXT;

-- AlterTable
ALTER TABLE "HospitalConfig" ADD COLUMN     "accountsTabEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "eInvoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "eInvoiceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "faviconDataUrl" TEXT,
ADD COLUMN     "tallyBankLedger" TEXT NOT NULL DEFAULT 'Bank Account',
ADD COLUMN     "tallyCashLedger" TEXT NOT NULL DEFAULT 'Cash',
ADD COLUMN     "tallyCgstLedger" TEXT NOT NULL DEFAULT 'Output CGST',
ADD COLUMN     "tallyCompanyName" TEXT,
ADD COLUMN     "tallyDebtorLedger" TEXT NOT NULL DEFAULT 'Sundry Debtors',
ADD COLUMN     "tallySalesConsultation" TEXT NOT NULL DEFAULT 'Consultation Income',
ADD COLUMN     "tallySalesIpd" TEXT NOT NULL DEFAULT 'Inpatient Income',
ADD COLUMN     "tallySalesLab" TEXT NOT NULL DEFAULT 'Laboratory Income',
ADD COLUMN     "tallySalesOther" TEXT NOT NULL DEFAULT 'Other Income',
ADD COLUMN     "tallySalesPharmacy" TEXT NOT NULL DEFAULT 'Pharmacy Sales',
ADD COLUMN     "tallySgstLedger" TEXT NOT NULL DEFAULT 'Output SGST';

-- CreateTable
CREATE TABLE "EInvoice" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "irn" TEXT,
    "ackNo" TEXT,
    "ackDt" TIMESTAMP(3),
    "signedQrCode" TEXT,
    "signedInvoice" TEXT,
    "payloadJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EInvoice_invoiceId_key" ON "EInvoice"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "EInvoice_irn_key" ON "EInvoice"("irn");

-- CreateIndex
CREATE INDEX "EInvoice_status_idx" ON "EInvoice"("status");

-- CreateIndex
CREATE INDEX "EInvoice_createdAt_idx" ON "EInvoice"("createdAt");

-- AddForeignKey
ALTER TABLE "EInvoice" ADD CONSTRAINT "EInvoice_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoice" ADD CONSTRAINT "EInvoice_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
