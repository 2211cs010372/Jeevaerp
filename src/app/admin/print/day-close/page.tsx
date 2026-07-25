import { DayCloseSheet } from "@/components/print/day-close-sheet";

/** Printable day-close statement. `?date=YYYY-MM-DD`; defaults to today. */
export default function DayClosePrintPage() {
  return <DayCloseSheet />;
}
