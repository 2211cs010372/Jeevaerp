"use client";

/**
 * The bench's door onto the price grid. See LabPriceGrid for what it does and
 * why it is separate from the catalogue screen.
 */

import { LabPriceGrid } from "@/components/portal/labs/price-grid";

export default function LabPricesPage() {
  return (
    <LabPriceGrid
      note={
        <>
          Names, codes and normal values are edited under <strong>Test catalog</strong>; GST is Admin&apos;s.
        </>
      }
    />
  );
}
