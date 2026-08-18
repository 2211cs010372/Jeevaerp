import { StayInvoicesSheet } from "@/components/print/stay-invoices-sheet";

export const metadata = { title: "All bills for the stay" };

/**
 * Every invoice raised against one stay, printed as a run - from the pharmacy
 * counter as well as reception.
 *
 * The pharmacy raised several of these bills itself and is where a family
 * standing at the medicine window asks for them. Sending that person back to
 * reception for a document this counter issued is the kind of walk that ends
 * with somebody deciding it can wait until discharge.
 */
export default function StayInvoicesPrintPage() {
  return <StayInvoicesSheet />;
}
