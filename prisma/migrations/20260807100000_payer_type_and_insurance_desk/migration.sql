-- PAYER: who settles a bill, and whether a day close should count it.
--
-- Every existing row is SELF_PAY, which is correct rather than merely convenient:
-- the first hospital handled no insurance at all, so every bill and every stay in
-- the table really was settled at a counter. The default carries that forward for
-- any desk that never touches the new toggle.

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('SELF_PAY', 'INSURANCE');

-- AlterEnum
-- ADD VALUE is allowed inside a transaction on PG 12+ as long as the new value is
-- not USED in the same transaction. Nothing below writes an INSURANCE_DESK row,
-- so this is safe here. BEFORE 'ADMIN' keeps the database's enum ordering
-- identical to schema.prisma, so a later `migrate diff` stays quiet.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'INSURANCE_DESK' BEFORE 'ADMIN';

-- AlterTable
ALTER TABLE "Admission"
  ADD COLUMN "payerType" "PayerType" NOT NULL DEFAULT 'SELF_PAY',
  ADD COLUMN "insurer" TEXT,
  ADD COLUMN "policyNo" TEXT,
  ADD COLUMN "memberId" TEXT;

-- AlterTable
ALTER TABLE "Invoice"
  ADD COLUMN "payer" "PayerType" NOT NULL DEFAULT 'SELF_PAY',
  ADD COLUMN "payerName" TEXT;

-- The day close reads one local day of bills and has to split insurance out of
-- the collected totals. Without this the split is a sequential scan over every
-- invoice the hospital has ever raised, once per shift close, on four portals.
CREATE INDEX "Invoice_payer_createdAt_idx" ON "Invoice"("payer", "createdAt");

-- The insurance desk's main list is "insurance patients currently in a bed".
CREATE INDEX "Admission_payerType_status_idx" ON "Admission"("payerType", "status");
