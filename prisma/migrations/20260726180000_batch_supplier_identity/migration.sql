-- Every batch traces to a supplier, and the supplier is part of the batch's
-- identity.
--
-- THE BUG THIS FIXES
-- StockBatch was keyed on [medicineId, batchNo]. When the same manufacturer
-- batch arrived from a second distributor, receiveGoods found the existing row
-- and merged into it: quantities added together, supplierId and purchasePrice
-- overwritten by whoever delivered last. The first distributor's consignment
-- silently stopped existing. A recall could not say which units came from whom,
-- a purchase return would go back to the wrong company, and the margin on the
-- remaining stock was computed at the wrong landed cost.
--
-- Each consignment is now its own row. FEFO is unaffected - it sorts on
-- expiryDate, which this does not touch.
--
-- ORDER MATTERS BELOW. The column cannot be made NOT NULL until every existing
-- row has a supplier, and the new unique index cannot be created until the
-- column is NOT NULL (Postgres treats NULLs as distinct, so a nullable column
-- in the key would let unlimited duplicates through the very gap we are
-- closing).

-- 1. Somewhere to put stock that predates procurement.
--    Named, not blank: an explicit "we don't know" is auditable, a NULL is not.
--    Inactive so it can never be picked for a new goods receipt.
INSERT INTO "Supplier" ("id", "name", "notes", "active", "createdAt", "updatedAt")
SELECT
  'supplier_opening_stock',
  'Opening stock (no supplier on record)',
  'Auto-created when supplier became mandatory on every batch. Holds stock that was on the shelf before procurement was in use. Inactive: it must never be selectable for a new delivery.',
  false,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Supplier" WHERE "id" = 'supplier_opening_stock');

-- 2. Adopt every orphan batch.
UPDATE "StockBatch" SET "supplierId" = 'supplier_opening_stock' WHERE "supplierId" IS NULL;

-- 3. Now the column can carry the guarantee.
ALTER TABLE "StockBatch" ALTER COLUMN "supplierId" SET NOT NULL;

-- 4. Swap the identity. The old key would reject the second distributor's row.
DROP INDEX IF EXISTS "StockBatch_medicineId_batchNo_key";
CREATE UNIQUE INDEX "StockBatch_medicineId_batchNo_supplierId_key"
  ON "StockBatch"("medicineId", "batchNo", "supplierId");

-- 5. The FK was created as ON DELETE SET NULL, which a NOT NULL column cannot
--    satisfy - a delete would fail with a confusing constraint error instead of
--    a clear one. RESTRICT says what is actually true: a supplier with stock
--    against it cannot be removed.
ALTER TABLE "StockBatch" DROP CONSTRAINT IF EXISTS "StockBatch_supplierId_fkey";
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
