-- THE POLICY'S CO-PAY, RECORDED ON THE CLAIM IT COMES OFF.
--
-- A policy with a 10% co-pay on a ₹1,00,000 sanction has the insurer paying
-- ₹90,000 and the family carrying ₹10,000, and the hospital has to COLLECT that
-- ₹10,000 at discharge.
--
-- The MONEY was already representable - the insurer approves less, and the
-- difference falls to the family through splitStay and out onto the dues list.
-- What was missing was the REASON. The desk read a part-approval, could not tell
-- a co-pay from a short-payment, and went to argue with a TPA about a shortfall
-- the policy had always said the family would carry.
--
-- approvedAmount IS UNCHANGED AND STAYS NET - it is what the insurer will
-- actually pay, and every downstream figure in this building is derived from it
-- (syncStayCoverage, allocateCoverage, splitStay, the dues lists). A column that
-- meant "gross" on rows written after today and "net" on rows written before it
-- would put two different answers on one discharge screen.
--
-- BOTH NULLABLE, AND NULL IS NOT ZERO. Null means nobody recorded a co-pay on
-- this claim, which is exactly what every claim decided before today means -
-- so there is no backfill, no rewrite, and no row changes meaning. A nullable
-- column with no default is added in place: Postgres does not rewrite the table
-- and does not hold a lock while a desk is billing.

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "copayAmount" DECIMAL(12,2),
ADD COLUMN     "copayPct" DECIMAL(5,2);
