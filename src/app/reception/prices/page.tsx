"use client";

/**
 * Reception's door onto the price grid - the same rows the bench edits under
 * Labs -> Test prices, through the same API. See LabPriceGrid.
 *
 * THIS DESK BILLS AGAINST THESE RATES, which is the reason the write was
 * originally closed to it: a counter that can set a price can discount a bill by
 * editing the menu, and that reduction appears nowhere in the discount column a
 * day close reads. Opening it is a deliberate call - reception is where a wrong
 * or ₹0 rate is actually discovered, usually with no lab staff left in the
 * building to fix it, and a test billed at ₹0 is a worse outcome than a rate
 * corrected by the person who spotted it.
 *
 * What makes that safe enough to live with is the audit trail, not the UI:
 * bulkUpdateCatalogPrices writes a CATALOG_PRICES_UPDATED row carrying who
 * changed which test, from what, to what. If a rate ever moves to suit a bill,
 * that row is how it is found - see the developer portal's audit log.
 */

import { LabPriceGrid } from "@/components/portal/labs/price-grid";

export default function ReceptionLabPricesPage() {
  return (
    <LabPriceGrid
      note={
        <>
          Every change is recorded against your name. Names, codes and normal values are
          edited by the lab under <strong>Test catalog</strong>; GST is Admin&apos;s.
        </>
      }
    />
  );
}
