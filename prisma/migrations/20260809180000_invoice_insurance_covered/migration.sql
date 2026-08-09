-- HOW MUCH OF A BILL THE INSURER AGREED TO PAY.
--
-- Invoice.payer answered "who is this bill with" as a yes/no. An insurer does
-- not answer yes/no - they answer with a NUMBER. A 2,00,000 stay approved at
-- 1,80,000 leaves 20,000 that is the family's, and there was nowhere in this
-- schema to put that 20,000.
--
-- So the bill was either wholly the insurer's - and the family was never asked
-- for their share, because every dues list filters payer = SELF_PAY - or it was
-- moved wholly back to the patient, and a family promised cashless was billed
-- two lakh rupees. Both are wrong and the first one loses the hospital money
-- silently, which is worse.
--
-- ── THE BACKFILL IS THE WHOLE POINT OF THIS MIGRATION ──
--
-- Every existing INSURANCE bill is set to its own total. That is precisely what
-- "this bill is with the insurer" meant before this column existed: the patient
-- owes nothing on it. SELF_PAY bills keep the default 0, which means the whole
-- total is the patient's - also exactly what it meant before.
--
-- The result is that NO BILL IN THE SYSTEM CHANGES MEANING on the day this
-- ships. Every dues list, every balance and every day close reads the same
-- before and after. The new behaviour only begins when an insurer's decision is
-- recorded against a stay and the coverage is allocated from it.
--
-- CANCELLED bills are included in the backfill deliberately. They are excluded
-- from every total by status, so their coverage figure is never read - but
-- leaving them at 0 would make a cancelled insurance bill look like a 2,00,000
-- patient debt to any future query that forgets the status filter.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "insuranceCoveredAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Backfill: an insurance bill was, by definition, wholly the insurer's.
UPDATE "Invoice"
   SET "insuranceCoveredAmount" = "totalAmount"
 WHERE "payer" = 'INSURANCE';
