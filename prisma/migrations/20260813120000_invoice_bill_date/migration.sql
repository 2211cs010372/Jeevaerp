-- THE DATE THE BILL SAYS, when that is not the moment it was typed in.
--
-- A treatment given on Saturday and billed on Monday printed "Bill Date:
-- Monday" - a date the patient can see is wrong on a document they hand to an
-- insurer, and one an insurer can reject the claim over.
--
-- A SEPARATE COLUMN rather than making `createdAt` editable, because
-- `createdAt` is what the day close, the collection report and every GST
-- return group money by. Editing it to fix a printed date would move that
-- bill's money out of one day's takings and into another's, and nothing on any
-- screen would say why.
--
-- NULLABLE, so it needs no backfill: null means "nobody has corrected this
-- one", and the printed sheet falls back to createdAt exactly as it does today.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billDate" TIMESTAMP(3);
