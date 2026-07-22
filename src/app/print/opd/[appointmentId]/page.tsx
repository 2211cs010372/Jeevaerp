import { OpdSheet } from "@/components/print/opd-sheet";

/**
 * Patient-facing OPD case sheet - the same stationery the desk prints, but fed
 * from the patient-scoped endpoint so a signed-in patient only ever sees their
 * own visit. Lives outside the marketing layout, so it prints clean.
 */
export default function PortalOpdPrintPage() {
  return <OpdSheet source="portal" />;
}
