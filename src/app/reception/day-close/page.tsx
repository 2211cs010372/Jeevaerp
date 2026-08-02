"use client";

import { DayCloseStatement } from "@/components/portal/day-close/day-close-statement";
import { TOPICS } from "@/lib/realtime/topics";

/**
 * Reception's own drawer. Explicitly `till=RECEPTION` rather than relying on the
 * caller's role, so an admin opening this page sees the front desk's position -
 * which is the only thing this page claims to show.
 */
export default function DayClosePage() {
  return (
    <DayCloseStatement
      endpoint="/reception/day-close?till=RECEPTION"
      subtitle="What should be in the front desk drawer, and whether it is."
      accent="teal"
      topics={[TOPICS.RECEPTION]}
    />
  );
}
