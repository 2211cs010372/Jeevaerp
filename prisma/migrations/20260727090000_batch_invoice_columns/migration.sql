-- The shelf now carries the distributor's own invoice columns.
--
-- A pharmacist reconciling stock reads the bill in one hand and the screen in
-- the other. Holding PACK, FREE and OMrp against the batch means the two are
-- the same document, in the same order, rather than the screen showing a
-- normalised interpretation the pharmacist has to translate back.
--
-- All three are additive and nullable/defaulted, so existing batches are
-- untouched and nothing needs backfilling: stock booked in before this simply
-- has no pack recorded, which is the truth.

ALTER TABLE "StockBatch" ADD COLUMN "pack"    TEXT;
ALTER TABLE "StockBatch" ADD COLUMN "freeQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StockBatch" ADD COLUMN "oMrp"    TEXT;
