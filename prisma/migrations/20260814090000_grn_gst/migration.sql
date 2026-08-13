-- GOODS RECEIPT: HOLD THE TAX, SO THE INVOICE COMPARISON CAN ADD IT BACK
--
-- A distributor's invoice total is GST INCLUSIVE. The receipt only ever summed
-- goods value, so every delivery of a taxable product was compared against a
-- bill that carried tax the receipt had never counted - and the difference was
-- flagged to the pharmacist as "Invoice differs" on a receipt that was correct.
-- The GST was, in effect, showing up as an unexplained extra charge.
--
-- `receivedValue` deliberately stays EX-GST: it is the cost basis that margin
-- and stock value are read off, and five screens already display it that way.
-- The tax goes in its own column and the comparison adds the two.
--
-- BACKFILL IS DELIBERATELY ZERO. Receipts posted before this migration never
-- captured a tax rate, so there is nothing to compute one from. Writing a
-- guessed figure onto a filed purchase record would be inventing money on a tax
-- document; those rows keep the variance they were posted with.

ALTER TABLE "GoodsReceipt"
  ADD COLUMN "receivedTax" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "GoodsReceiptItem"
  ADD COLUMN "gstRatePct" DECIMAL(4,2) NOT NULL DEFAULT 0;
