"use client";

/**
 * Admin's door onto the price grid - the same rows the lab edits under Labs ->
 * Test prices, through the same API. One record, two doors, exactly as the
 * catalogue itself works. See LabPriceGrid.
 */

import { LabPriceGrid } from "@/components/portal/labs/price-grid";

export default function AdminLabPricesPage() {
  return (
    <LabPriceGrid
      note={
        <>
          Names, codes and GST rates are edited under <strong>Lab catalog &amp; GST</strong>.
        </>
      }
    />
  );
}
