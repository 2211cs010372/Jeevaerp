import { IpServicesBillSheet } from "@/components/print/ip-services-bill-sheet";

export const metadata = { title: "IP services bill" };

/**
 * The self-pay stay bill. THIS is its home desk: the discount is agreed at the
 * discharge counter and the family is standing at it, and the sheet exists to
 * settle that conversation on paper rather than in somebody's head.
 */
export default function ReceptionServicesBillPrintPage() {
  return <IpServicesBillSheet />;
}
