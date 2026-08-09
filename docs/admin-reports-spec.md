# Admin reports — GST by slab, GST return summary, supplier spend

Status: **spec, not yet built**
Decided: slabs `0 / 5 / 12 / 18` · supplier spend tracks **real cash** (new model) · build GST reports first

---

## Context

Admin has `day-close`, `bills`, `pharmacy` and `accounts` screens, plus a Tally
export. None of them can answer the two questions the proprietor and the CA
actually ask at month end:

1. **"Ee month lo GST slab wise entha?"** — how much did we bill at 0%, 5%, 12%,
   18%, day by day, so the monthly return can be filed and checked.
2. **"Money ekkada పెట్టాము?"** — what went out to pharmacy distributors, and how
   much of it is still owed.

`buildTallyExport` ([tally-export.service.ts:89](../src/server/services/tally-export.service.ts))
is the closest thing that exists. It posts Sales / Receipt / Credit Note vouchers
over a date range using **invoice-level** `cgstAmount` / `sgstAmount`. It cannot
break a bill down by slab, and it is an export format, not a screen.

Confirmed by grep: **no GST-slab grouping exists anywhere in the codebase.**

---

## Current state — what the data can and cannot do

### Tax lives at two levels, and only one of them knows the slab

| Column | Level | Knows the slab? |
|---|---|---|
| `Invoice.taxableAmount`, `cgstAmount`, `sgstAmount` | invoice | ✗ one total per bill |
| `InvoiceItem.gstRatePct`, `amount`, `hsnSac` | line | ✓ |

A single pharmacy bill genuinely spans slabs — a 5% tablet and a 12% syrup on the
same receipt. So **every slab figure must be derived from `InvoiceItem`**, and
`Invoice.cgstAmount` can only ever serve as the reconciliation check.

### The discount is already apportioned per line

From `computeInvoiceTotals` ([calc.ts:60](../src/server/billing/calc.ts)):

```
discountRatio     = discount / subtotal          // invoice level
lineAfterDiscount = amount × (1 − discountRatio) // per line
taxable           = Σ lineAfterDiscount
lineTax           = lineAfterDiscount × gstRatePct / 100
cgst = Σ lineTax/2      sgst = Σ lineTax/2
```

**This is the whole reason the GST reports need no schema change.** The report
reproduces exactly this arithmetic from `InvoiceItem.amount`,
`Invoice.discountAmount` and `Invoice.subtotal`, and lands on the same
`taxableAmount` / `cgstAmount` / `sgstAmount` already stored on the invoice.

One caveat that must not be swept under the carpet: `computeInvoiceTotals`
rounds (`r2`) at each accumulation step. Re-aggregating per slab and then
totalling can differ from the stored invoice total by a paisa or two on a bill
with many lines. The report **surfaces that delta as a reconciliation row**
rather than hiding it — a GST report that silently disagrees with the invoices
it was built from is worse than no report.

### There is no supplier payment record

`supplierDetail()` ([procurement.service.ts:156](../src/server/services/procurement.service.ts))
computes `purchasedTotal` from `GoodsReceipt.receivedValue` — that is what the
distributor **invoiced**, not what the hospital **paid**. `creditOutstanding`
counts purchase-return claims.

There is no model anywhere recording money going **out** to a supplier. So today
the question "how much do we still owe Vishwanath Medical Stores" has no answer.

---

## Proposed change

### Report 1 — Monthly sales by GST slab, per day

Admin picks a month. Grid: one row per date, one column per slab.

```
Date        0%       5%      12%      18%     Total
01 Aug   4,000    1,240        —        —     5,240
02 Aug   2,500      620        —        —     3,120
…
TOTAL   82,400   14,880        —        —    97,280
```

- Each cell shows **taxable value**; a toggle switches to **tax amount**.
- Row total and column total; grand total reconciles against
  `Σ Invoice.taxableAmount` for the month, delta shown if non-zero.
- Fixed columns `0 / 5 / 12 / 18`. A slab with no activity still prints, so two
  months can be compared side by side. Any rate found in the data outside that
  set (e.g. a hand-set 7%) lands in an **"Other"** column rather than being
  dropped — silently discarding a bill from a tax report is the one unacceptable
  failure here.
- Excludes `status: CANCELLED`. A cancelled bill never became income.
- Grouped by **local calendar day**, matching how `dayClose` already buckets.

### Report 2 — Monthly GST return summary

Return-shaped rollup for the chosen month:

| Slab | Taxable | CGST | SGST | Total tax | Invoices |
|---|---|---|---|---|---|

Plus:
- **B2C vs B2B split.** `Invoice.buyerGstin` presence is what makes a bill B2B
  (see the `Invoice` doc comment) — that is the e-invoicing / GSTR-1 distinction.
- **Refunds** deducted, from `Refund` rows in the month, shown on their own line.
  Money genuinely left the drawer; `buildTallyExport` already treats them this way.
- **By source** (`CONSULTATION / LAB / PHARMACY / IPD / OTHER`) as a second cut,
  since lab work is largely exempt and pharmacy is largely 5% — the two behave
  differently and the CA asks for them separately.
- CSV download for the CA. Reuses the existing export route pattern
  (`/api/v1/admin/export/tally`).

### Report 3 — Supplier spend and outstanding

New model — **the only schema change in this spec**:

```prisma
/// Money actually paid OUT to a distributor. GoodsReceipt records what was
/// invoiced; this records what left the bank. Without it "purchased" and
/// "paid" are the same number, and they are not.
model SupplierPayment {
  id             String   @id @default(cuid())
  supplierId     String
  supplier       Supplier @relation(fields: [supplierId], references: [id])
  /// Optional: a payment settling one specific delivery. Null = on account.
  goodsReceiptId String?
  goodsReceipt   GoodsReceipt? @relation(fields: [goodsReceiptId], references: [id])
  mode           PaymentMode
  amount         Decimal  @db.Decimal(12, 2)
  /// UTR / cheque number - what accounts matches against the bank statement.
  reference      String?
  paidOn         DateTime @db.Date
  notes          String?
  paidById       String
  paidBy         User     @relation("SupplierPaymentPaidBy", fields: [paidById], references: [id])
  createdAt      DateTime @default(now())

  @@index([supplierId, paidOn])
  @@index([paidOn])
}
```

Reuses the existing `PaymentMode` enum — no parallel tax or payment system.

Screen, per supplier for the month:

```
Vishwanath Medical Stores          terms: 30d
  Purchased (Aug)     ₹48,200
  Paid                ₹30,000
  Return credits      −₹1,150
  ───────────────────────────
  OUTSTANDING         ₹17,050
     of which overdue  ₹4,200
```

- **Purchased** = `Σ GoodsReceipt.receivedValue` in the month.
- **Paid** = `Σ SupplierPayment.amount`.
- **Return credits** = `Σ PurchaseReturn.creditedAmount` (settled) — the claimed
  figure is not money until they actually credit it.
- **Overdue** = unpaid deliveries older than `Supplier.paymentTermDays`.

---

## Out of scope

- Editing or restating any historical invoice.
- GSTR-1 / GSTR-3B JSON filing format. This is a **report to read and check**,
  not a filing integration. CSV out; the CA files.
- ITC (input tax credit) on purchases. Needs supplier-invoice GST captured per
  line, which `GoodsReceiptItem` does not store today.
- Backfilling historical supplier payments. The ledger starts from the day it
  ships; pre-existing deliveries show as unpaid until someone records payment.
- Any change to how invoices are calculated. The report reads; it never writes.

---

## Migration plan

| Step | Change | Risk |
|---|---|---|
| 1 | Reports 1 + 2 | **None.** Read-only aggregation over existing columns. |
| 2 | `SupplierPayment` model | Additive: one new table, one FK on an existing one. No column altered, nothing backfilled. |
| 3 | Payment-entry UI on the supplier screen | Additive. |

`prisma migrate deploy` only. No `migrate reset`. Same pattern as
`20260809120000_pharmacy_master_data`.

---

## How we know it's done

- [ ] A month with known bills reconciles: grid grand total == `Σ Invoice.taxableAmount`, delta row reads ₹0.00.
- [ ] A multi-slab pharmacy bill splits across two columns on its date, and the two halves sum to that invoice's own taxable value.
- [ ] A discounted bill's slab figures reproduce `Invoice.taxableAmount` exactly (proves the apportionment matches `calc.ts`).
- [ ] A CANCELLED bill appears nowhere.
- [ ] A refund reduces the month's tax on the summary.
- [ ] A rate outside 0/5/12/18 appears under "Other", never silently dropped.
- [ ] Recording a supplier payment moves Outstanding down by exactly that amount.
- [ ] A delivery older than `paymentTermDays` with no payment shows as overdue.
- [ ] Unit tests on the aggregation, no database required — same pattern as `insurance-split.test.ts`.

---

## Open question for later

`InvoiceItem` has no `hsnSac`-level tax columns, so an **HSN-wise summary**
(which GSTR-1 does want) can be derived but not verified against stored totals
the way the slab report can. Worth doing once the slab report is trusted.
