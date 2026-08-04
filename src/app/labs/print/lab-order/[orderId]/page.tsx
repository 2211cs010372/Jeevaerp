import { LabOrderReportSheets } from "@/components/print/lab-order-report-sheets";

/** Every report on one lab order, one page per test, in a single print job. */
export default function LabOrderReportPrintPage() {
  return <LabOrderReportSheets />;
}
