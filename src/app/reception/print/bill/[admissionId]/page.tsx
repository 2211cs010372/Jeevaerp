import { DetailedBillSheet } from "@/components/print/detailed-bill-sheet";

export const metadata = { title: "Detailed bill" };

/**
 * The same claim bill, reachable from the front desk. Families ask for a copy at
 * discharge to send to their own insurer on a reimbursement, and the desk should
 * not have to ring the insurance room to get one.
 */
export default function ReceptionBillPrintPage() {
  return <DetailedBillSheet />;
}
