import { DischargeSummary } from "@/components/print/discharge-summary";

/**
 * The SAME discharge summary reception prints - same component, same data, same
 * paper. The insurance desk gets its own route only because the portals are
 * separate origins; nothing about the document differs.
 *
 * Deliberately not an insurance-specific layout. A claim assessor and a family
 * comparing two copies of one discharge must not be able to find a difference.
 */
export default function DischargeSummaryPrintPage() {
  return <DischargeSummary />;
}
