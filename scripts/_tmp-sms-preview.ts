/**
 * Prints the exact text of every notification, by calling the real senders.
 *
 * Every provider key is deleted first, so nothing here can reach a network -
 * each call falls to the dev-log branch and hands back the preview it WOULD
 * have sent. That is the point: these are not hand-written samples, they are
 * the strings notify.service.ts actually builds.
 */
import {
  notifyOpBooked, notifyOpCancelled, notifyBillGenerated, notifyAdvanceReceived,
  notifyLabReportReady, notifyAdmitted, notifyDischarged, notifySupplierPo,
  notifyStockReceived, notifyLowStock,
} from "../src/server/services/notify.service";

delete process.env.FAST2SMS_API_KEY;
delete process.env.TWO_FACTOR_API_KEY;
delete process.env.SMS_NOTIFICATIONS;
process.env.SMS_ADMIN_NUMBERS = "9876543210";

const PATIENT = "9876543210";
const captured: { label: string; to: string; text: string }[] = [];

const realLog = console.log;
console.log = (...args: unknown[]) => {
  const line = String(args[0] ?? "");
  const m = /^\[sms:dev\] (\S+) -> (\S+): (.*?)(?:  \(no .*\))?$/.exec(line);
  if (m) captured.push({ label: m[1], to: m[2], text: m[3] });
  else realLog(...args);
};

async function main() {
  await notifyOpBooked(PATIENT, {
    name: "Anitha Reddy", opNumber: "OP-2408", doctor: "Dr. Shireesha Ch",
    date: new Date("2026-08-14"), time: "10:30",
  });
  await notifyOpCancelled(PATIENT, {
    name: "Anitha Reddy", opNumber: "OP-2408", date: new Date("2026-08-14"),
  });
  await notifyBillGenerated(PATIENT, {
    name: "Anitha Reddy", receiptNo: "INV-10294", total: 400, balanceDue: 0, source: "CONSULTATION",
  });
  await notifyBillGenerated(PATIENT, {
    name: "Ramesh Kumar", receiptNo: "INV-10318", total: 1285.5, balanceDue: 285.5, source: "PHARMACY",
  });
  await notifyBillGenerated(PATIENT, {
    name: "Ramesh Kumar", receiptNo: "INV-10322", total: 1750, balanceDue: 1750, source: "LAB",
  });
  await notifyLabReportReady(PATIENT, {
    name: "Ramesh Kumar", testName: "Complete Blood Picture", reference: "JH-004127",
  });
  await notifyAdmitted(PATIENT, {
    name: "Lakshmi Devi", ipNumber: "IP-0417", ward: "General Ward", bedNo: "G-12",
  });
  await notifyAdvanceReceived(PATIENT, {
    name: "Lakshmi Devi", amount: 25000, ipNumber: "IP-0417",
  });
  await notifyDischarged(PATIENT, {
    name: "Lakshmi Devi", ipNumber: "IP-0417", days: 4, balanceDue: 8450,
  });
  await notifySupplierPo("9876543211", {
    supplierName: "Apex Pharma Distributors", poNumber: "PO-0233", lineCount: 14,
  });
  await notifyStockReceived({
    grnNumber: "GRN-0198", supplierName: "Apex Pharma Distributors", value: 48250,
  });
  await notifyLowStock({ belowReorder: 37, outOfStock: 6 });

  console.log = realLog;

  for (const c of captured) {
    const len = c.text.length;
    // GSM-7 fits 160 chars in one segment; past that a message is split and
    // billed per part. 306 (not 320) because concatenation eats 7 chars a part.
    const segments = len <= 160 ? 1 : len <= 306 ? 2 : 3;
    console.log(`\n${c.label}  ->  ${c.to}`);
    console.log(`  "${c.text}"`);
    console.log(`  ${len} chars · ${segments} SMS`);
  }
  console.log(`\n${captured.length} messages\n`);
}

main().catch((e) => { console.log = realLog; console.error(e); process.exit(1); });
