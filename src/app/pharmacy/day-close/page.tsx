"use client";

import { DayCloseStatement } from "@/components/portal/day-close/day-close-statement";

/** The medicine window's own drawer. */
export default function PharmacyDayClosePage() {
  return (
    <DayCloseStatement
      endpoint="/pharmacy/day-close"
      subtitle="What should be in the pharmacy drawer, and whether it is."
      accent="blue"
    />
  );
}
