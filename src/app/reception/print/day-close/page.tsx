import { DayCloseSheet } from "@/components/print/day-close-sheet";

/**
 * The front desk's own copy of the day-close statement - the sheet that gets
 * signed and handed over with the drawer.
 *
 * The same component the admin print route renders. Reception needs its own
 * path because middleware gates /admin to the ADMIN role alone, so a
 * receptionist could never open that one; without this route the Print button
 * had nothing to point at and fell back to printing the portal screen.
 *
 * `?date=YYYY-MM-DD&till=RECEPTION`. The API pins a receptionist to their own
 * till regardless of the query, so `till` only does work when an admin prints
 * the front desk's drawer from the same page.
 */
export default function ReceptionDayClosePrintPage() {
  return <DayCloseSheet />;
}
