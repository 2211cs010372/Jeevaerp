import { RunningTabSheet } from "@/components/print/running-tab-sheet";

export const metadata = { title: "Running tab" };

/**
 * The stay's running tab, from the insurance desk.
 *
 * A pre-authorisation goes out mid-stay and the assessor asks what the stay is
 * at today. This is that answer on paper, stamped with the moment it was taken
 * and saying on its face that it is not a bill.
 */
export default function RunningTabPrintPage() {
  return <RunningTabSheet />;
}
