-- PACKS versus UNITS.
--
-- A distributor sells PACKS. A patient buys UNITS. The system had one bare
-- `quantity` doing both jobs, so every downstream number lied:
--
--   Receiving "PARACETAMOL 500MG · PACK 15T · QTY 3" stored quantity = 3,
--   when 45 tablets were physically on the shelf.
--   Dispensing 5 tablets was then refused - "only 3 available".
--   And MRP 18.59 (the price of the STRIP) was billed PER TABLET, charging
--   a patient Rs 92.95 for five paracetamol instead of Rs 6.20.
--
-- Syrups make it unarguable: a 200ML bottle and a 500ML bottle of the same
-- product cannot share one unitless count.
--
-- THE RULE FROM HERE:
--   StockBatch.quantity  - ALWAYS dispensing units (tablets, ml, capsules)
--   StockBatch.packSize  - units per purchased pack, from the invoice's PACK
--   StockBatch.mrp       - PER PACK, as printed on the carton
--   purchasePrice        - PER PACK, as invoiced
--
-- MIGRATION SAFETY. packSize defaults to 1, which makes every existing row mean
-- exactly what it meant before: loose units, priced per unit. Nothing is
-- retroactively multiplied. Batches received AFTER this carry their real pack
-- size, so the two coexist correctly and no backfill is guessed at - we do not
-- know how the stock already on the shelf was counted, and inventing a pack
-- size for it would corrupt a physical count rather than fix one.

ALTER TABLE "StockBatch" ADD COLUMN "packSize" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Medicine"   ADD COLUMN "defaultPackSize" INTEGER NOT NULL DEFAULT 1;

-- A pack size below 1 would multiply stock to zero on the next receipt.
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_packSize_positive" CHECK ("packSize" >= 1);
ALTER TABLE "Medicine"   ADD CONSTRAINT "Medicine_defaultPackSize_positive" CHECK ("defaultPackSize" >= 1);
