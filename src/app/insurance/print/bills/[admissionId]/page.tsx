import { StayInvoicesSheet } from "@/components/print/stay-invoices-sheet";

export const metadata = { title: "All bills for the stay" };

/**
 * Every invoice raised against one stay, as a run - the claim file's bill
 * bundle. A TPA asking for "the bills" means all of them, and assembling that
 * by opening receipt numbers one at a time is how one goes missing.
 */
export default function StayInvoicesPrintPage() {
  return <StayInvoicesSheet />;
}
