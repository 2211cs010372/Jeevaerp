-- AN INSURER'S SETTLEMENT IS A PAYMENT, BUT IT IS NOT COUNTER MONEY.
--
-- Recording a claim settlement had to close the bills it paid - without a
-- Payment row an invoice reads as unpaid forever, whatever the insurer sent. But
-- recording it as NETBANKING would put a bank transfer into a receptionist's
-- shift takings for money that never crossed their counter.
--
-- So it gets its own mode, and every till reconciliation excludes it explicitly.
-- See the enum's doc in schema.prisma and the day close in reports.service.

-- AlterEnum
-- Safe inside a transaction on PG 12+: nothing below writes a row using the new
-- value, so it is never read in the same transaction that creates it.
ALTER TYPE "PaymentMode" ADD VALUE IF NOT EXISTS 'INSURANCE';
