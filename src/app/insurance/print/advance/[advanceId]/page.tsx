import { AdvanceReceipt } from "@/components/print/advance-receipt";

/**
 * The IPD deposit slip, reprintable from the insurance desk.
 *
 * The desk can now take an advance on a stay (see the stay sheet), so it needs
 * the slip that goes with it - a deposit taken at one counter and printable
 * only at another is a receipt the family leaves without.
 */
export default function AdvanceReceiptPage() {
  return <AdvanceReceipt />;
}
