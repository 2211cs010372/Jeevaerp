import { StayInvoicesSheet } from "@/components/print/stay-invoices-sheet";

export const metadata = { title: "All bills for the stay" };

/**
 * Every invoice raised against one stay, printed as a single run: the ward's
 * IPD bill, the pharmacy's and the lab's, each still its own tax document.
 */
export default function StayInvoicesPrintPage() {
  return <StayInvoicesSheet />;
}
