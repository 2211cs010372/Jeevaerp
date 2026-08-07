-- THE PUBLISHED RATE CARD, as its own table.
--
-- Everything that is not a bed, a lab test or a medicine had no catalogue at
-- all: the inpatient tab took a typed description and a typed price. See the
-- ServiceCharge doc in schema.prisma for why that had to stop.

-- CreateEnum
CREATE TYPE "ServiceGroup" AS ENUM ('IP_CHARGE', 'SURGERY_OPEN', 'SURGERY_LAPAROSCOPIC', 'OTHER');

-- CreateTable
CREATE TABLE "ServiceCharge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" "ServiceGroup" NOT NULL DEFAULT 'IP_CHARGE',
    "category" "ChargeCategory" NOT NULL DEFAULT 'OTHER',
    "price" DECIMAL(10,2) NOT NULL,
    "gstRatePct" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "perDay" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCharge_name_key" ON "ServiceCharge"("name");

-- The picker reads one group at a time, active only.
CREATE INDEX "ServiceCharge_group_active_idx" ON "ServiceCharge"("group", "active");
