import { InvoiceSheet } from "@/components/print/invoice-sheet";

/**
 * Patient-facing bill - the same Bill-of-Supply sheet the desk prints, fed from
 * the patient-scoped endpoint so a signed-in patient only ever sees their own
 * invoice. Lives outside the marketing layout, so it prints clean.
 */
export default function PortalInvoicePrintPage() {
  return <InvoiceSheet source="portal" />;
}
