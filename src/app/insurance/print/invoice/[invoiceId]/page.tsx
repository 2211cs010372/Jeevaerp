import { InvoiceSheet } from "@/components/print/invoice-sheet";

export const metadata = { title: "Bill" };

/**
 * ANY ONE BILL, PRINTED FROM THE INSURANCE ROOM.
 *
 * The claim file an insurer wants is not the summary sheet - it is the
 * individual receipts behind it: the pharmacy slips, the lab bills, the
 * consultation charge from before the patient was ever admitted. The desk was
 * already linking to this page from the "All bills" panel; the page simply did
 * not exist on this subdomain, so every one of those links landed on not-found
 * and the room printed claim attachments from somebody else's login.
 *
 * One sheet covers every source, because a Jeeva bill is a Jeeva bill whether
 * it came off the medicine counter or the ward.
 */
export default function InsuranceInvoicePrintPage() {
  return <InvoiceSheet />;
}
