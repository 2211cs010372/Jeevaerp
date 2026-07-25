-- A printable acknowledgement for the IPD deposit.
--
-- Reception takes cash from a family at admission and, until now, handed back
-- nothing but a screen message. A money receipt needs a number that can be
-- quoted, reconciled and disputed - and with several advances possible on one
-- stay, the IP number alone cannot tell two slips apart.
--
-- Its own ADV- series, not the INVOICE one: a deposit is money HELD, not a
-- supply, so it must never consume a tax-invoice number. The deposit still
-- reaches the ledger the same way it always did - as a payment credited against
-- the discharge invoice (see billing.service advancePaymentRef).
--
-- NULLABLE: advances taken before this migration have no number and will print
-- as "not numbered". Backfilling would invent receipts that were never handed
-- over, which is worse than an honest blank.

ALTER TABLE "AdmissionAdvance" ADD COLUMN "receiptNo" TEXT;

CREATE UNIQUE INDEX "AdmissionAdvance_receiptNo_key" ON "AdmissionAdvance"("receiptNo");
