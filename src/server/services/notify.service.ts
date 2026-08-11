import { sendTemplatedSms, sendAppointmentSms } from "@/lib/sms";
import { bedLabel } from "@/lib/beds";

/**
 * Every SMS the hospital sends a patient, a supplier or an administrator that
 * is NOT a one-time code.
 *
 * ─── WHY THIS FILE EXISTS SEPARATELY FROM lib/sms.ts ───────────────────────
 * lib/sms.ts knows how to get characters onto a handset. This file knows what
 * the hospital actually says, and to whom. Keeping the wording here means the
 * message a patient receives can be read in one screenful, by somebody who is
 * registering DLT templates and does not care about provider quirks.
 *
 * ─── THE RULE EVERY CALLER RELIES ON ───────────────────────────────────────
 * NOTHING HERE THROWS. Every function is called after a committed transaction -
 * the bill exists, the patient is admitted, the report is signed. An SMS that
 * fails must leave all of that standing. Callers therefore do not need a
 * try/catch and must NOT await these inside a `prisma.$transaction`: a ten
 * second provider timeout inside a transaction holds a row lock on a billing
 * table for ten seconds.
 *
 * ─── BEFORE ANY OF THIS SENDS: DLT ─────────────────────────────────────────
 * Indian carriers reject transactional SMS with unregistered wording. Each
 * template below must be registered (Fast2SMS dashboard -> DLT -> Add Template),
 * and the Message ID it is given pasted into the env var named beside it. Until
 * then that message logs its text to the server console instead of sending, and
 * says so. Registering them is a business process, not a deploy - which is why
 * every one is independent and switching them on is one env var at a time.
 *
 * ─── THE ORDER TRAP ────────────────────────────────────────────────────────
 * A DLT template is a string of anonymous {#var#} slots. No provider checks
 * that your values line up with them, so a template written in a different
 * order than the `vars` array below sends a confident, well-formatted lie -
 * "your bill 4500 for Rs INV-1029". Each sender states its required template
 * body verbatim. Register that body, in that order.
 */

/** Money as it should read in a message: no decimals, Indian grouping. */
function rs(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-IN");
}

/** "12 Aug 2026" - the only date format that is unambiguous to every reader. */
function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * First names only. A message that opens "Dear Merugu Nagaruthwik Reddy," reads
 * like a bank; the desk calls people by their first name and so should this.
 * Also buys back characters against the 160 an SMS segment holds - a second
 * segment is a second charge.
 */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

/** Who gets the operational alerts. Empty => nobody, which is a valid choice. */
function adminNumbers(): string[] {
  return (process.env.SMS_ADMIN_NUMBERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Outcome = { sent: boolean; reason?: string };
const skipped = (reason: string): Outcome => ({ sent: false, reason });

// ---------------------------------------------------------------------------
// PATIENT - outpatient
// ---------------------------------------------------------------------------

/**
 * OP visit booked. Covers BOTH the reception desk and the public website, and
 * deliberately reuses SMS_APPOINTMENT_TEMPLATE rather than registering a second
 * template: the patient cannot tell which counter typed it, so the message is
 * the same message and one DLT approval should cover both.
 *
 * TEMPLATE (SMS_APPOINTMENT_TEMPLATE):
 *   Dear {#var#}, your appointment {#var#} with {#var#} is confirmed for
 *   {#var#} at {#var#}. - Jeeva Hospital
 */
export async function notifyOpBooked(
  phone: string,
  v: { name: string; opNumber: string; doctor: string; date: Date | string; time: string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const date = typeof v.date === "string" ? v.date : dayLabel(v.date);
    return await sendAppointmentSms(phone, {
      name: firstName(v.name),
      opNumber: v.opNumber,
      doctor: v.doctor,
      date,
      time: v.time,
    });
  } catch (err) {
    console.error("[notify] op-booked threw", err);
    return skipped("threw");
  }
}

/**
 * OP visit cancelled. Sent because the alternative is a patient travelling in
 * for a visit that no longer exists - the one notification whose absence costs
 * the patient a morning.
 *
 * TEMPLATE (SMS_TPL_OP_CANCELLED):
 *   Dear {#var#}, your appointment {#var#} on {#var#} at Jeeva Hospital has
 *   been cancelled. Please call the desk to rebook.
 */
export async function notifyOpCancelled(
  phone: string,
  v: { name: string; opNumber: string; date: Date | string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const date = typeof v.date === "string" ? v.date : dayLabel(v.date);
    const name = firstName(v.name);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_OP_CANCELLED,
      vars: [name, v.opNumber, date],
      preview: `Dear ${name}, your appointment ${v.opNumber} on ${date} at Jeeva Hospital has been cancelled. Please call the desk to rebook.`,
      label: "op-cancelled",
    });
  } catch (err) {
    console.error("[notify] op-cancelled threw", err);
    return skipped("threw");
  }
}

// ---------------------------------------------------------------------------
// PATIENT - money
// ---------------------------------------------------------------------------

/**
 * A bill was raised. One sender for every counter, because a patient with a
 * pharmacy bill and a lab bill on the same visit should not have to learn two
 * message formats to check what they paid.
 *
 * The PHARMACY variant is separate only because the medicine counter is the one
 * a patient uses repeatedly without a consultation, so the message names the
 * counter to make an unexpected charge identifiable.
 *
 * TEMPLATE (SMS_TPL_BILL):
 *   Dear {#var#}, bill {#var#} for Rs {#var#} has been generated at Jeeva
 *   Hospital. Balance Rs {#var#}.
 *
 * TEMPLATE (SMS_TPL_PHARMACY_BILL):
 *   Dear {#var#}, pharmacy bill {#var#} for Rs {#var#} has been generated at
 *   Jeeva Hospital. Balance Rs {#var#}.
 */
export async function notifyBillGenerated(
  phone: string,
  v: {
    name: string;
    receiptNo: string;
    total: number | string;
    balanceDue: number | string;
    source: "CONSULTATION" | "LAB" | "PHARMACY" | "IPD" | "OTHER" | string;
  }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const isPharmacy = v.source === "PHARMACY";
    const name = firstName(v.name);
    const total = rs(v.total);
    const balance = rs(v.balanceDue);
    const what = isPharmacy ? "pharmacy bill" : "bill";
    return await sendTemplatedSms(phone, {
      templateId: isPharmacy ? process.env.SMS_TPL_PHARMACY_BILL : process.env.SMS_TPL_BILL,
      vars: [name, v.receiptNo, total, balance],
      preview: `Dear ${name}, ${what} ${v.receiptNo} for Rs ${total} has been generated at Jeeva Hospital. Balance Rs ${balance}.`,
      label: isPharmacy ? "pharmacy-bill" : "bill",
    });
  } catch (err) {
    console.error("[notify] bill threw", err);
    return skipped("threw");
  }
}

/**
 * Deposit taken against an inpatient stay. Sent because an advance is the one
 * payment with no immediate bill behind it - the family hands over money and
 * gets a slip, and the SMS is the copy that does not get lost in a ward bag.
 *
 * TEMPLATE (SMS_TPL_ADVANCE):
 *   Dear {#var#}, advance of Rs {#var#} received against admission {#var#} at
 *   Jeeva Hospital.
 */
export async function notifyAdvanceReceived(
  phone: string,
  v: { name: string; amount: number | string; ipNumber: string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const name = firstName(v.name);
    const amount = rs(v.amount);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_ADVANCE,
      vars: [name, amount, v.ipNumber],
      preview: `Dear ${name}, advance of Rs ${amount} received against admission ${v.ipNumber} at Jeeva Hospital.`,
      label: "advance-received",
    });
  } catch (err) {
    console.error("[notify] advance threw", err);
    return skipped("threw");
  }
}

// ---------------------------------------------------------------------------
// PATIENT - diagnostics
// ---------------------------------------------------------------------------

/**
 * Lab report is ready to collect.
 *
 * DELIBERATELY CARRIES NO RESULT. A value in an SMS is a clinical finding
 * delivered with no one present to explain it, to a phone that may be shared or
 * read by someone else in the family. This says a report exists and where to
 * get it; the result is handed over by a person.
 *
 * TEMPLATE (SMS_TPL_LAB_REPORT):
 *   Dear {#var#}, your {#var#} report ({#var#}) is ready for collection at
 *   Jeeva Hospital.
 */
export async function notifyLabReportReady(
  phone: string,
  v: { name: string; testName: string; reference: string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const name = firstName(v.name);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_LAB_REPORT,
      vars: [name, v.testName, v.reference],
      preview: `Dear ${name}, your ${v.testName} report (${v.reference}) is ready for collection at Jeeva Hospital.`,
      label: "lab-report-ready",
    });
  } catch (err) {
    console.error("[notify] lab-report threw", err);
    return skipped("threw");
  }
}

// ---------------------------------------------------------------------------
// PATIENT - inpatient
// ---------------------------------------------------------------------------

/**
 * Admitted to a bed. The IP number is the thing a family is asked for at every
 * counter for the rest of the stay, so it goes on a phone rather than a slip.
 *
 * The bed is ONE variable, not ward + number. `bedLabel` already renders
 * "ICU BED 2", and splitting it back into two slots reintroduces the "ICU ·
 * ICU-02" stutter this template used to send.
 *
 * TEMPLATE (SMS_TPL_ADMITTED):
 *   Dear {#var#}, admission {#var#} is confirmed at Jeeva Hospital, {#var#}.
 */
export async function notifyAdmitted(
  phone: string,
  v: { name: string; ipNumber: string; ward: string; bedNo: string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const name = firstName(v.name);
    const bed = bedLabel(v.ward, v.bedNo);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_ADMITTED,
      vars: [name, v.ipNumber, bed],
      preview: `Dear ${name}, admission ${v.ipNumber} is confirmed at Jeeva Hospital, ${bed}.`,
      label: "admitted",
    });
  } catch (err) {
    console.error("[notify] admitted threw", err);
    return skipped("threw");
  }
}

/**
 * Discharged. Carries the balance because the final bill is the one number a
 * family is still arguing about in the car park.
 *
 * TEMPLATE (SMS_TPL_DISCHARGED):
 *   Dear {#var#}, discharge for admission {#var#} is complete. Stay {#var#}
 *   day(s), balance Rs {#var#}. Get well soon. - Jeeva Hospital
 */
export async function notifyDischarged(
  phone: string,
  v: { name: string; ipNumber: string; days: number; balanceDue: number | string }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const name = firstName(v.name);
    const balance = rs(v.balanceDue);
    const days = String(v.days);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_DISCHARGED,
      vars: [name, v.ipNumber, days, balance],
      preview: `Dear ${name}, discharge for admission ${v.ipNumber} is complete. Stay ${days} day(s), balance Rs ${balance}. Get well soon. - Jeeva Hospital`,
      label: "discharged",
    });
  } catch (err) {
    console.error("[notify] discharged threw", err);
    return skipped("threw");
  }
}

// ---------------------------------------------------------------------------
// SUPPLIER
// ---------------------------------------------------------------------------

/**
 * A purchase order has been sent to a distributor.
 *
 * NOT the order itself. An SMS cannot carry twenty line items, and a supplier
 * who dispatches against a truncated text will short the hospital and both
 * sides will blame the other. This is a "check your email / call us" nudge that
 * names the PO, and the PO document remains the contract.
 *
 * TEMPLATE (SMS_TPL_SUPPLIER_PO):
 *   {#var#}: purchase order {#var#} ({#var#} items) has been raised by Jeeva
 *   Hospital. Please confirm dispatch.
 */
export async function notifySupplierPo(
  phone: string | null | undefined,
  v: { supplierName: string; poNumber: string; lineCount: number }
): Promise<Outcome> {
  try {
    if (!phone) return skipped("no-phone");
    const lines = String(v.lineCount);
    return await sendTemplatedSms(phone, {
      templateId: process.env.SMS_TPL_SUPPLIER_PO,
      vars: [v.supplierName, v.poNumber, lines],
      preview: `${v.supplierName}: purchase order ${v.poNumber} (${lines} items) has been raised by Jeeva Hospital. Please confirm dispatch.`,
      label: "supplier-po",
    });
  } catch (err) {
    console.error("[notify] supplier-po threw", err);
    return skipped("threw");
  }
}

// ---------------------------------------------------------------------------
// ADMIN / OPERATIONS
// ---------------------------------------------------------------------------

/**
 * Send one message to every number in SMS_ADMIN_NUMBERS.
 *
 * Sequential, not Promise.all: this is a handful of numbers on a path nobody is
 * waiting on, and providers rate-limit bursts from one account. Failures are
 * per-number - one bad entry in the env var must not silence the rest.
 */
async function fanOutToAdmins(
  spec: { templateId?: string; vars: string[]; preview: string; label: string }
): Promise<Outcome> {
  const numbers = adminNumbers();
  if (numbers.length === 0) return skipped("no-admin-numbers");
  let sent = 0;
  for (const n of numbers) {
    const r = await sendTemplatedSms(n, spec);
    if (r.sent) sent += 1;
  }
  return sent > 0 ? { sent: true } : skipped("all-failed");
}

/**
 * Stock booked in against a GRN. Goes to administrators, not the pharmacy: the
 * pharmacist is the person who just typed it and does not need telling. This is
 * the owner's copy - money left the business and inventory arrived, and the two
 * should be visible to whoever reconciles them without opening the ERP.
 *
 * TEMPLATE (SMS_TPL_STOCK_RECEIVED):
 *   Jeeva Hospital: stock received {#var#} from {#var#}, value Rs {#var#}.
 */
export async function notifyStockReceived(
  v: { grnNumber: string; supplierName: string; value: number | string }
): Promise<Outcome> {
  try {
    const value = rs(v.value);
    return await fanOutToAdmins({
      templateId: process.env.SMS_TPL_STOCK_RECEIVED,
      vars: [v.grnNumber, v.supplierName, value],
      preview: `Jeeva Hospital: stock received ${v.grnNumber} from ${v.supplierName}, value Rs ${value}.`,
      label: "stock-received",
    });
  } catch (err) {
    console.error("[notify] stock-received threw", err);
    return skipped("threw");
  }
}

/**
 * Items have fallen below their reorder level.
 *
 * A COUNT, NEVER A LIST. "37 medicines are below reorder level" is one segment
 * and sends the reader to the screen that can actually act; naming them is
 * several segments, several charges, and still not enough to order from.
 *
 * DELIBERATELY NOT WIRED TO ANY CALL SITE YET, and that is the honest state:
 * this alert only makes sense fired ONCE A DAY, and this system has no nightly
 * job to hang it on (see TODOS.md, "Worth a line in the nightly job whenever one
 * exists"). The two places it could be bolted onto today are both wrong -
 * `dispense` would text the owner every few minutes, and `dayClose` in
 * reports.service.ts is a READ that runs every time somebody opens the screen.
 *
 * Wire it from the nightly job when that job exists, or from an explicit
 * "notify me" button on /admin/pharmacy. Feed it from `stockAlerts()`.
 *
 * TEMPLATE (SMS_TPL_LOW_STOCK):
 *   Jeeva Hospital: {#var#} item(s) are at or below reorder level, {#var#} out
 *   of stock. Please review purchase.
 */
export async function notifyLowStock(
  v: { belowReorder: number; outOfStock: number }
): Promise<Outcome> {
  try {
    if (v.belowReorder === 0 && v.outOfStock === 0) return skipped("nothing-low");
    const below = String(v.belowReorder);
    const out = String(v.outOfStock);
    return await fanOutToAdmins({
      templateId: process.env.SMS_TPL_LOW_STOCK,
      vars: [below, out],
      preview: `Jeeva Hospital: ${below} item(s) are at or below reorder level, ${out} out of stock. Please review purchase.`,
      label: "low-stock",
    });
  } catch (err) {
    console.error("[notify] low-stock threw", err);
    return skipped("threw");
  }
}
