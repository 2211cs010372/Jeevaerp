"use client";

import { DayCloseStatement } from "@/components/portal/day-close/day-close-statement";
import { TOPICS } from "@/lib/realtime/topics";

/** The sample counter's own drawer. */
export default function LabsDayClosePage() {
  return (
    <DayCloseStatement
      endpoint="/labs/day-close"
      subtitle="What should be in the lab drawer, and whether it is."
      accent="teal"
      topics={[TOPICS.LABS]}
    />
  );
}
