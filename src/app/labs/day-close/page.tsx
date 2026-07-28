"use client";

import { DayCloseStatement } from "@/components/portal/day-close/day-close-statement";

/** The sample counter's own drawer. */
export default function LabsDayClosePage() {
  return (
    <DayCloseStatement
      endpoint="/labs/day-close"
      subtitle="What should be in the lab drawer, and whether it is."
      accent="teal"
    />
  );
}
