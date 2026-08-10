import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  notifyOpBooked,
  notifyOpCancelled,
  notifyBillGenerated,
  notifyAdvanceReceived,
  notifyLabReportReady,
  notifyAdmitted,
  notifyDischarged,
  notifySupplierPo,
  notifyStockReceived,
  notifyLowStock,
} from "@/server/services/notify.service";

/**
 * These run with NO provider key set, so nothing here can reach a network. That
 * is the point: every assertion below is about what the ERP decides BEFORE a
 * provider is involved, which is the part that can be wrong in production
 * without anybody noticing - a message that silently never sends looks exactly
 * like a message that sent.
 */

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.FAST2SMS_API_KEY;
  delete process.env.TWO_FACTOR_API_KEY;
  delete process.env.SMS_PROVIDER;
  delete process.env.SMS_NOTIFICATIONS;
  delete process.env.SMS_ADMIN_NUMBERS;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("SMS_TPL_") || k === "SMS_APPOINTMENT_TEMPLATE") delete process.env[k];
  }
});
afterEach(() => { process.env = { ...saved }; });

const PHONE = "9876543210";

/**
 * THE CONTRACT EVERY CALL SITE DEPENDS ON.
 *
 * Each of these is called after a committed transaction - the bill exists, the
 * patient is admitted, the report is signed. If one of them threw, the caller
 * would surface a 500 for work that actually succeeded, and a receptionist
 * would re-take a payment that was already recorded. Nothing about an SMS is
 * worth that, so the rule is absolute and tested with deliberately hostile
 * input rather than assumed.
 */
describe("no notification ever throws", () => {
  const junk = undefined as unknown as string;

  it("survives missing phones, empty names and NaN money", async () => {
    const calls: Promise<{ sent: boolean }>[] = [
      notifyOpBooked(junk, { name: junk, opNumber: junk, doctor: junk, date: junk, time: junk }),
      notifyOpCancelled(junk, { name: junk, opNumber: junk, date: junk }),
      notifyBillGenerated(junk, { name: junk, receiptNo: junk, total: NaN, balanceDue: "abc", source: junk }),
      notifyAdvanceReceived(junk, { name: junk, amount: NaN, ipNumber: junk }),
      notifyLabReportReady(junk, { name: junk, testName: junk, reference: junk }),
      notifyAdmitted(junk, { name: junk, ipNumber: junk, ward: junk, bedNo: junk }),
      notifyDischarged(junk, { name: junk, ipNumber: junk, days: NaN, balanceDue: NaN }),
      notifySupplierPo(junk, { supplierName: junk, poNumber: junk, lineCount: NaN }),
      notifyStockReceived({ grnNumber: junk, supplierName: junk, value: NaN }),
      notifyLowStock({ belowReorder: NaN, outOfStock: NaN }),
    ];
    const results = await Promise.all(calls);
    expect(results).toHaveLength(10);
    for (const r of results) expect(r.sent).toBe(false);
  });

  it("reports a missing phone as a reason, not an exception", async () => {
    const r = await notifyLabReportReady("", { name: "Asha", testName: "CBP", reference: "JH-1" });
    expect(r).toEqual({ sent: false, reason: "no-phone" });
  });
});

/**
 * The kill switch exists because these cost money per message at a counter that
 * bills a few hundred times a day, and the hospital must be able to stop the
 * firehose without a deploy. If it ever silently stopped working, the first
 * evidence would be the phone bill.
 */
describe("SMS_NOTIFICATIONS kill switch", () => {
  it("stops a notification even when a provider and template are configured", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_LAB_REPORT = "12345";
    process.env.SMS_NOTIFICATIONS = "off";

    const r = await notifyLabReportReady(PHONE, { name: "Asha", testName: "CBP", reference: "JH-1" });
    expect(r).toEqual({ sent: false, reason: "disabled" });
  });

  it("is case and whitespace tolerant - a config toggle nobody should have to quote exactly", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_ADMITTED = "12345";
    process.env.SMS_NOTIFICATIONS = "  OFF  ";

    const r = await notifyAdmitted(PHONE, { name: "Asha", ipNumber: "IP-1", ward: "General", bedNo: "12" });
    expect(r.reason).toBe("disabled");
  });

  it("any other value means ON - only the exact word disables", async () => {
    process.env.SMS_NOTIFICATIONS = "on";
    const r = await notifyAdmitted(PHONE, { name: "Asha", ipNumber: "IP-1", ward: "General", bedNo: "12" });
    // No provider configured in this suite, so it stops later - but NOT as
    // "disabled", which is the distinction being asserted.
    expect(r.reason).not.toBe("disabled");
  });
});

/**
 * An unregistered DLT template must never be reported as sent. India rejects
 * free-text transactional SMS, so "no template" means the message did not go
 * out - and a caller that recorded it as delivered would leave the desk
 * believing a patient was told something they were not.
 */
describe("unregistered templates fail visibly", () => {
  it("says no-template when the provider is live but the template is not registered", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    const r = await notifyBillGenerated(PHONE, {
      name: "Asha", receiptNo: "INV-1", total: 400, balanceDue: 0, source: "PHARMACY",
    });
    expect(r).toEqual({ sent: false, reason: "no-template" });
  });

  it("says not-configured when there is no provider at all", async () => {
    const r = await notifyBillGenerated(PHONE, {
      name: "Asha", receiptNo: "INV-1", total: 400, balanceDue: 0, source: "LAB",
    });
    expect(r).toEqual({ sent: false, reason: "not-configured" });
  });

  it("routes the pharmacy bill to its own template, not the general one", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    // Only the GENERAL template is registered.
    process.env.SMS_TPL_BILL = "111";

    // A pharmacy bill must not quietly borrow it - the wording differs, and DLT
    // approval is per-body.
    const pharmacy = await notifyBillGenerated(PHONE, {
      name: "Asha", receiptNo: "INV-1", total: 400, balanceDue: 0, source: "PHARMACY",
    });
    expect(pharmacy.reason).toBe("no-template");
  });
});

/**
 * A number that cannot receive an SMS is a data problem at the registration
 * desk, not a provider fault. Separating them stops "the SMS never arrived"
 * being investigated as an outage for a patient whose record holds a landline.
 *
 * THE LIMIT OF THIS CHECK, found by writing it: only landlines whose area code
 * does not begin 6-9 can be caught. "0870 2345678" (Warangal) normalises to
 * 8702345678 once the dialling zero is stripped, which is a structurally valid
 * mobile number and is accepted. Nothing in the number itself says otherwise -
 * telling those apart needs an HLR lookup, not a regex. So this catches the
 * obvious rubbish and no more, and the desk remains the real defence.
 */
describe("non-mobile numbers are identified, not attempted", () => {
  it("skips a landline rather than paying to fail", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_LAB_REPORT = "12345";

    // Hyderabad landline: normalises to 4023456789, and no Indian mobile starts 4.
    const r = await notifyLabReportReady("040 2345 6789", {
      name: "Asha", testName: "CBP", reference: "JH-1",
    });
    expect(r).toEqual({ sent: false, reason: "not-mobile" });
  });

  it("skips a number that is too short to be anything", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_LAB_REPORT = "12345";

    const r = await notifyLabReportReady("12345", {
      name: "Asha", testName: "CBP", reference: "JH-1",
    });
    expect(r).toEqual({ sent: false, reason: "not-mobile" });
  });
});

/**
 * The admin alerts fan out to a list in one env var. An empty list is a valid
 * configuration - a hospital that does not want them - and must not read as a
 * failure in the log.
 */
describe("admin alerts", () => {
  it("is a no-op, not an error, when no admin numbers are configured", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_STOCK_RECEIVED = "12345";

    const r = await notifyStockReceived({ grnNumber: "GRN-1", supplierName: "Apex", value: 12500 });
    expect(r).toEqual({ sent: false, reason: "no-admin-numbers" });
  });

  it("ignores blank entries left by a trailing comma", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_STOCK_RECEIVED = "12345";
    process.env.SMS_ADMIN_NUMBERS = " , ,, ";

    // All entries are blank, so this is still "nobody configured" rather than an
    // attempt to text an empty string.
    const r = await notifyStockReceived({ grnNumber: "GRN-1", supplierName: "Apex", value: 1 });
    expect(r.reason).toBe("no-admin-numbers");
  });

  it("does not send a low-stock alert when nothing is low", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_LOW_STOCK = "12345";
    process.env.SMS_ADMIN_NUMBERS = PHONE;

    // "0 items are below reorder level" is a message that costs money to say
    // nothing. The guard is what makes this alert safe to run on a schedule.
    const r = await notifyLowStock({ belowReorder: 0, outOfStock: 0 });
    expect(r).toEqual({ sent: false, reason: "nothing-low" });
  });

  it("does send when only out-of-stock is non-zero", async () => {
    process.env.SMS_ADMIN_NUMBERS = PHONE;
    const r = await notifyLowStock({ belowReorder: 0, outOfStock: 3 });
    // No provider in this suite, so it stops at the provider check - the point
    // is that it got PAST the "nothing is low" guard.
    expect(r.reason).not.toBe("nothing-low");
  });
});

/**
 * A supplier with no phone number on record is the normal case, not an error -
 * plenty of distributors are on a landline, and the PO document is the order.
 */
describe("supplier notification", () => {
  it("treats a supplier with no phone as a no-op", async () => {
    process.env.FAST2SMS_API_KEY = "k";
    process.env.SMS_TPL_SUPPLIER_PO = "12345";

    const r = await notifySupplierPo(null, { supplierName: "Apex", poNumber: "PO-1", lineCount: 4 });
    expect(r).toEqual({ sent: false, reason: "no-phone" });
  });
});
