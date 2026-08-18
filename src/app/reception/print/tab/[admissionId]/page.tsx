import { RunningTabSheet } from "@/components/print/running-tab-sheet";

export const metadata = { title: "Running tab" };

/**
 * The stay's running tab, on paper.
 *
 * A ward round, a family asking where the stay stands before agreeing to
 * another day, or an audit of a charge that was later corrected - all of them
 * needed the tab off the screen and in a hand. It is deliberately NOT a bill:
 * see the sheet for what it refuses to look like and why.
 */
export default function RunningTabPrintPage() {
  return <RunningTabSheet />;
}
