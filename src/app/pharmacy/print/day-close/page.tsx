import { PharmacyDayCloseSheet } from "@/components/print/pharmacy-day-close-sheet";

/**
 * Printable Pharmacy day-close & GST reconciliation statement.
 * Supports `?date=YYYY-MM-DD`. Defaults to today.
 */
export default function PharmacyDayClosePrintPage() {
  return <PharmacyDayCloseSheet />;
}
