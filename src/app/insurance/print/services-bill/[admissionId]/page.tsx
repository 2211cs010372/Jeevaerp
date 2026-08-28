import { IpServicesBillSheet } from "@/components/print/ip-services-bill-sheet";

export const metadata = { title: "IP services bill" };

/**
 * The same self-pay bill, reachable from the insurance room.
 *
 * That is not a contradiction: the stay this sheet is most often wanted for is
 * one the insurance desk has just finished arguing about. They record the
 * refusal, move the stay onto the family, and the next question - "what do they
 * owe now" - is answered here rather than by walking to reception.
 */
export default function InsuranceServicesBillPrintPage() {
  return <IpServicesBillSheet />;
}
