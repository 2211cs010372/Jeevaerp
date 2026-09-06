import { toE164, isIndianMobile, toBare10 } from "@/lib/phone";

/**
 * THE DAILY REPORT - its shape, its recipients, and how it reads.
 *
 * Everything in this file is PURE: no Prisma, no fetch, no env beyond what is
 * handed in. The numbers are gathered in daily-report.service.ts; this is the
 * half that can be tested without a database, which matters because the part
 * most likely to be wrong is not the SQL - it is a rupee figure rendered into a
 * message that fifteen people read every night.
 *
 * ─── WHY THE EMAIL AND THE WHATSAPP MESSAGE ARE NOT THE SAME REPORT ────────
 * The email is the COMPLETE statement: every till, every mode, every counter.
 * The WhatsApp message is the eight numbers an owner actually reads standing in
 * a corridor, and it is capped hard - a WhatsApp template's variables cannot
 * contain newlines, and a wall of figures on a phone is not read at all. Anyone
 * who wants the detail opens the mail. They are deliberately different lengths
 * of the same truth, and both are generated from ONE object so they can never
 * disagree about a number.
 */

// ---------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------

export interface ReportTill {
  label: string;
  collected: number;
  refunded: number;
  net: number;
  cash: number;
  digital: number;
  bills: number;
}

export interface ReportMode {
  mode: string;
  collected: number;
  refunded: number;
  net: number;
  count: number;
}

export interface ReportSource {
  source: string;
  net: number;
  count: number;
}

export interface DailyReport {
  /** The calendar day this report is ABOUT, "YYYY-MM-DD" local. */
  date: string;
  /** When it was assembled. A report run at 9:30 PM is not a closed day. */
  generatedAt: string;
  hospital: { name: string };

  /**
   * MONEY THAT CROSSED A COUNTER. Every figure here comes from dayCloseByTill,
   * unchanged - see the note in the service about why it is not re-derived.
   */
  money: {
    collected: number;
    refunded: number;
    net: number;
    cash: number;
    payments: number;
    /** Bills raised today that settle at a counter. Not money. */
    bills: number;
    /** Billed to an insurer today. Shown, never added to `collected`. */
    insuranceBills: number;
    insuranceAmount: number;
    /** Settlements banked today against older claims. Outside every drawer. */
    insurerReceipts: number;
    tills: ReportTill[];
    modes: ReportMode[];
    bySource: ReportSource[];
  };

  /** WHAT WAS BILLED, which is a different question from what was collected. */
  billing: {
    billed: number;
    billCount: number;
    discountGiven: number;
    cancelled: number;
    cancelledValue: number;
    /** Raised today, self-pay, still short. A debt somebody can be asked for. */
    dueFromToday: number;
    /** Every unpaid self-pay bill the hospital is carrying, all dates. */
    dueTotal: number;
  };

  opd: {
    booked: number;
    completed: number;
    cancelled: number;
    newPatients: number;
  };

  ipd: {
    admissions: number;
    /** Every way a stay ended today, not just DISCHARGED. */
    closures: number;
    closureKinds: { status: string; count: number }[];
    inHouse: number;
    beds: { total: number; occupied: number; free: number };
    advances: number;
    advanceCount: number;
  };

  lab: { ordered: number; completed: number; pending: number };

  pharmacy: {
    sales: number;
    billCount: number;
    profit: number;
    marginPct: number;
    lowStock: number;
    outOfStock: number;
    expiringSoon: number;
  };

  /** Busiest doctors of the day, by revenue. */
  doctors: { doctor: string; department: string; visits: number; revenue: number }[];

  insurance: {
    claimsRaised: number;
    claimsRaisedValue: number;
    claimsSettled: number;
    claimsSettledValue: number;
  };

  /** Things worth acting on tomorrow morning. Empty is a good day. */
  alerts: string[];
}

// ---------------------------------------------------------------------------
// RECIPIENTS
// ---------------------------------------------------------------------------

/**
 * Split a human-typed list into addresses.
 *
 * Accepts commas, semicolons, newlines and stray spaces, because the field is
 * filled in by whoever is at the admin screen and "a@x.com; b@x.com" is what
 * people actually paste. Case-insensitive de-duplication: two admins listed as
 * Owner@ and owner@ are one inbox and must not get two copies.
 */
export function parseEmailList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of String(raw ?? "").split(/[,;\s]+/)) {
    const addr = piece.trim();
    // Deliberately loose. This is an internal distribution list an admin typed,
    // not a signup form - the job here is to drop obvious junk ("and", "-"),
    // and the provider is the authority on whether an address is deliverable.
    if (!addr || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

/**
 * Split a human-typed list into storage-form mobile numbers (+91XXXXXXXXXX).
 *
 * Anything that is not a plausible Indian mobile is dropped here rather than at
 * the provider, so a landline typed into the recipients box is visible as a
 * shorter list on the settings screen instead of a nightly provider error.
 */
export function parsePhoneList(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  // NOT split on spaces the way the email list is. "+91 98765 43210" is ONE
  // number written the way people write it, and splitting there turns it into
  // three fragments that are all silently dropped - a recipient who vanishes
  // without an error anywhere. So the separators are commas, semicolons and
  // new lines only.
  for (const chunk of String(raw ?? "").split(/[,;\n]+/)) {
    const piece = chunk.trim();
    if (!piece) continue;
    // ...but somebody will separate two numbers with a space. When a piece
    // holds more digits than one number can, fall back to splitting on
    // whitespace rather than dropping a 20-digit blob in silence.
    const parts = piece.replace(/\D/g, "").length > 12 ? piece.split(/\s+/) : [piece];
    for (const part of parts) {
      const bare = toBare10(part);
      // isIndianMobile is the only filter there is, and it cannot catch
      // everything: a landline written 0870-2345678 loses its trunk 0 and reads
      // as the mobile 8702345678. Numbers that a human typed wrong are caught
      // by the delivery failure, which the settings screen prints per number.
      if (!bare || !isIndianMobile(bare)) continue;
      const e164 = toE164(bare);
      if (!e164 || seen.has(e164)) continue;
      seen.add(e164);
      out.push(e164);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FORMATTING
// ---------------------------------------------------------------------------

/** Money as it reads on an Indian statement: grouped, no paise. */
export function rs(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-IN");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Sun, 6 Sep 2026" - the only date format that is unambiguous to every reader.
 *
 * Built by hand rather than with toLocaleDateString, which is not the same
 * function everywhere: the ICU data on one Node build renders September as
 * "Sept" and on another as "Sep". A report subject line that changes shape with
 * the runtime is the kind of difference that makes people distrust the numbers
 * underneath it. The weekday is here because "was that a Sunday?" is the first
 * question asked about a quiet day's takings.
 */
export function dayLabel(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return `${WEEKDAYS[dt.getDay()]}, ${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}

/**
 * Escape anything that came out of the database before it goes into the HTML.
 *
 * Doctor names, ward labels and till names are typed by staff. One apostrophe
 * or ampersand is harmless; a name containing a stray "<" would silently eat
 * the rest of a table row, and nobody reading a report notices a missing line.
 */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// THE EMAIL
// ---------------------------------------------------------------------------

const INK = "#12242c";
const MUTED = "#6b7f88";
const LINE = "#e3eaed";
const TEAL = "#0f766e";
const ROSE = "#b4405a";

function row(label: string, value: string, opts?: { bold?: boolean; tone?: "good" | "bad" }): string {
  const color = opts?.tone === "good" ? TEAL : opts?.tone === "bad" ? ROSE : INK;
  const weight = opts?.bold ? "700" : "500";
  return (
    `<tr>` +
    `<td style="padding:7px 0;border-bottom:1px solid ${LINE};font:13px system-ui,-apple-system,Segoe UI,sans-serif;color:${MUTED}">${esc(label)}</td>` +
    `<td align="right" style="padding:7px 0;border-bottom:1px solid ${LINE};font:${weight} 13px system-ui,-apple-system,Segoe UI,sans-serif;color:${color}">${value}</td>` +
    `</tr>`
  );
}

function section(title: string, body: string): string {
  return (
    `<tr><td style="padding:22px 0 8px">` +
    `<div style="font:600 11px system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:${MUTED}">${esc(title)}</div>` +
    `</td></tr>` +
    `<tr><td><table width="100%" cellpadding="0" cellspacing="0" role="presentation">${body}</table></td></tr>`
  );
}

/**
 * The complete statement, as HTML a mail client will actually render.
 *
 * Tables and inline styles, not flexbox and a stylesheet: Outlook and Gmail
 * both drop <style> blocks in ways that turn a careful layout into a column of
 * unstyled text. This is ugly to write and it is the only thing that survives.
 */
export function renderReportHtml(r: DailyReport): string {
  const tillRows = r.money.tills
    .map((t) =>
      row(t.label, `₹${rs(t.net)}<span style="color:${MUTED};font-weight:400"> · cash ₹${rs(t.cash)}</span>`)
    )
    .join("");

  const modeRows = r.money.modes
    .filter((m) => m.collected > 0 || m.refunded > 0)
    .map((m) => row(m.mode, `₹${rs(m.net)}<span style="color:${MUTED};font-weight:400"> · ${m.count} tender${m.count === 1 ? "" : "s"}</span>`))
    .join("");

  const sourceRows = r.money.bySource
    .filter((s) => s.net !== 0)
    .map((s) => row(s.source, `₹${rs(s.net)}`))
    .join("");

  const doctorRows = r.doctors.length
    ? r.doctors
        .map((d) => row(`${d.doctor} · ${d.department}`, `₹${rs(d.revenue)}<span style="color:${MUTED};font-weight:400"> · ${d.visits} visit${d.visits === 1 ? "" : "s"}</span>`))
        .join("")
    : row("No consultation or ward billing today", "—");

  const closureDetail = r.ipd.closureKinds.length
    ? r.ipd.closureKinds.map((c) => `${c.count} ${c.status.toLowerCase().replace(/_/g, " ")}`).join(", ")
    : "";

  const alerts = r.alerts.length
    ? `<tr><td style="padding:20px 0 0">` +
      `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fdf3f5;border:1px solid #f0d6dd;border-radius:10px">` +
      `<tr><td style="padding:14px 16px">` +
      `<div style="font:700 12px system-ui,-apple-system,Segoe UI,sans-serif;color:${ROSE};letter-spacing:.05em;text-transform:uppercase">Needs attention</div>` +
      r.alerts
        .map((a) => `<div style="margin-top:6px;font:13px system-ui,-apple-system,Segoe UI,sans-serif;color:${INK}">• ${esc(a)}</div>`)
        .join("") +
      `</td></tr></table></td></tr>`
    : "";

  return (
    `<div style="background:#f5f8f9;padding:24px 12px">` +
    `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#fff;border:1px solid ${LINE};border-radius:14px">` +
    `<tr><td style="padding:26px 28px 0">` +
    `<div style="font:700 19px system-ui,-apple-system,Segoe UI,sans-serif;color:${INK}">${esc(r.hospital.name)}</div>` +
    `<div style="margin-top:3px;font:13px system-ui,-apple-system,Segoe UI,sans-serif;color:${MUTED}">Daily report · ${esc(dayLabel(r.date))}</div>` +
    `</td></tr>` +

    `<tr><td style="padding:18px 28px 0">` +
    `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f0f7f6;border-radius:12px">` +
    `<tr>` +
    `<td style="padding:16px 18px" width="50%">` +
    `<div style="font:600 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Collected</div>` +
    `<div style="margin-top:2px;font:700 24px system-ui,sans-serif;color:${TEAL}">₹${rs(r.money.net)}</div>` +
    `</td>` +
    `<td style="padding:16px 18px" width="50%">` +
    `<div style="font:600 11px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Cash in hand</div>` +
    `<div style="margin-top:2px;font:700 24px system-ui,sans-serif;color:${INK}">₹${rs(r.money.cash)}</div>` +
    `</td>` +
    `</tr></table></td></tr>` +

    `<tr><td style="padding:0 28px 26px">` +
    `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">` +

    section(
      "Money",
      row("Collected at counters", `₹${rs(r.money.collected)}`) +
        row("Refunded", `₹${rs(r.money.refunded)}`, { tone: r.money.refunded > 0 ? "bad" : undefined }) +
        row("Net", `₹${rs(r.money.net)}`, { bold: true }) +
        row("Tenders taken", String(r.money.payments)) +
        row("Billed to insurers today", `₹${rs(r.money.insuranceAmount)} · ${r.money.insuranceBills} bill${r.money.insuranceBills === 1 ? "" : "s"}`) +
        row("Insurer settlements banked", `₹${rs(r.money.insurerReceipts)}`)
    ) +

    section("By counter", tillRows) +
    section("By payment type", modeRows || row("Nothing collected today", "—")) +
    section("What the money was for", sourceRows || row("No counter takings today", "—")) +

    section(
      "Billing",
      row("Billed today", `₹${rs(r.billing.billed)} · ${r.billing.billCount} bill${r.billing.billCount === 1 ? "" : "s"}`) +
        row("Discount given", `₹${rs(r.billing.discountGiven)}`) +
        row("Cancelled bills", `${r.billing.cancelled} · ₹${rs(r.billing.cancelledValue)}`) +
        row("Unpaid from today", `₹${rs(r.billing.dueFromToday)}`, { tone: r.billing.dueFromToday > 0 ? "bad" : undefined }) +
        row("Outstanding, all dates", `₹${rs(r.billing.dueTotal)}`, { bold: true })
    ) +

    section(
      "Outpatient",
      row("Appointments", String(r.opd.booked)) +
        row("Completed", String(r.opd.completed)) +
        row("Cancelled", String(r.opd.cancelled)) +
        row("New patients registered", String(r.opd.newPatients))
    ) +

    section(
      "Ward",
      row("Admissions", String(r.ipd.admissions)) +
        row("Stays closed", closureDetail ? `${r.ipd.closures} · ${esc(closureDetail)}` : String(r.ipd.closures)) +
        row("In house now", String(r.ipd.inHouse)) +
        row("Beds", `${r.ipd.beds.occupied} of ${r.ipd.beds.total} occupied · ${r.ipd.beds.free} free`) +
        row("Deposits taken", `₹${rs(r.ipd.advances)} · ${r.ipd.advanceCount}`)
    ) +

    section(
      "Laboratory",
      row("Tests ordered", String(r.lab.ordered)) +
        row("Completed", String(r.lab.completed)) +
        row("Still pending", String(r.lab.pending), { tone: r.lab.pending > 0 ? "bad" : undefined })
    ) +

    section(
      "Pharmacy",
      row("Sales", `₹${rs(r.pharmacy.sales)} · ${r.pharmacy.billCount} bill${r.pharmacy.billCount === 1 ? "" : "s"}`) +
        row("Profit", `₹${rs(r.pharmacy.profit)} · ${r.pharmacy.marginPct}% margin`) +
        row("At or below reorder level", String(r.pharmacy.lowStock)) +
        row("Out of stock", String(r.pharmacy.outOfStock)) +
        row("Expiring soon", String(r.pharmacy.expiringSoon))
    ) +

    section("Doctors", doctorRows) +

    section(
      "Insurance",
      row("Claims raised", `${r.insurance.claimsRaised} · ₹${rs(r.insurance.claimsRaisedValue)}`) +
        row("Claims settled", `${r.insurance.claimsSettled} · ₹${rs(r.insurance.claimsSettledValue)}`)
    ) +

    alerts +

    `<tr><td style="padding:22px 0 0">` +
    `<div style="font:11.5px system-ui,-apple-system,Segoe UI,sans-serif;color:${MUTED};line-height:1.6">` +
    `Generated ${esc(new Date(r.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}. ` +
    `Counter figures match the day-close statement in the admin console for the same date. ` +
    `Insurer billing and settlements are shown separately because no drawer sees that money.` +
    `</div></td></tr>` +

    `</table></td></tr></table></div>`
  );
}

// ---------------------------------------------------------------------------
// THE PLAIN-TEXT ALTERNATIVE
// ---------------------------------------------------------------------------

/**
 * Same report, as text. Not a courtesy: a mail with no text part is scored as
 * spam by most filters, and this is the copy that has to survive being read on
 * a watch or forwarded into a chat.
 */
export function renderReportText(r: DailyReport): string {
  const L: string[] = [];
  L.push(`${r.hospital.name} - daily report`);
  L.push(dayLabel(r.date));
  L.push("");
  L.push("MONEY");
  L.push(`  Collected      Rs ${rs(r.money.collected)}`);
  L.push(`  Refunded       Rs ${rs(r.money.refunded)}`);
  L.push(`  Net            Rs ${rs(r.money.net)}`);
  L.push(`  Cash in hand   Rs ${rs(r.money.cash)}`);
  L.push(`  To insurers    Rs ${rs(r.money.insuranceAmount)} (${r.money.insuranceBills} bills)`);
  L.push(`  Settlements    Rs ${rs(r.money.insurerReceipts)}`);
  L.push("");
  L.push("BY COUNTER");
  for (const t of r.money.tills) L.push(`  ${t.label.padEnd(14)} Rs ${rs(t.net)} (cash Rs ${rs(t.cash)})`);
  L.push("");
  L.push("BILLING");
  L.push(`  Billed today   Rs ${rs(r.billing.billed)} (${r.billing.billCount} bills)`);
  L.push(`  Discount       Rs ${rs(r.billing.discountGiven)}`);
  L.push(`  Cancelled      ${r.billing.cancelled} (Rs ${rs(r.billing.cancelledValue)})`);
  L.push(`  Unpaid today   Rs ${rs(r.billing.dueFromToday)}`);
  L.push(`  Outstanding    Rs ${rs(r.billing.dueTotal)}`);
  L.push("");
  L.push("PATIENTS");
  L.push(`  OP appointments ${r.opd.booked} (completed ${r.opd.completed}, cancelled ${r.opd.cancelled})`);
  L.push(`  New patients    ${r.opd.newPatients}`);
  L.push(`  Admissions      ${r.ipd.admissions}`);
  L.push(`  Stays closed    ${r.ipd.closures}`);
  L.push(`  In house        ${r.ipd.inHouse} (beds ${r.ipd.beds.occupied}/${r.ipd.beds.total})`);
  L.push(`  Deposits        Rs ${rs(r.ipd.advances)}`);
  L.push("");
  L.push("LAB");
  L.push(`  Ordered ${r.lab.ordered} | completed ${r.lab.completed} | pending ${r.lab.pending}`);
  L.push("");
  L.push("PHARMACY");
  L.push(`  Sales Rs ${rs(r.pharmacy.sales)} | profit Rs ${rs(r.pharmacy.profit)} (${r.pharmacy.marginPct}%)`);
  L.push(`  Low stock ${r.pharmacy.lowStock} | out of stock ${r.pharmacy.outOfStock} | expiring ${r.pharmacy.expiringSoon}`);
  if (r.doctors.length) {
    L.push("");
    L.push("DOCTORS");
    for (const d of r.doctors) L.push(`  ${d.doctor} (${d.department}) - ${d.visits} visits, Rs ${rs(d.revenue)}`);
  }
  L.push("");
  L.push("INSURANCE");
  L.push(`  Claims raised  ${r.insurance.claimsRaised} (Rs ${rs(r.insurance.claimsRaisedValue)})`);
  L.push(`  Claims settled ${r.insurance.claimsSettled} (Rs ${rs(r.insurance.claimsSettledValue)})`);
  if (r.alerts.length) {
    L.push("");
    L.push("NEEDS ATTENTION");
    for (const a of r.alerts) L.push(`  - ${a}`);
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// THE WHATSAPP MESSAGE
// ---------------------------------------------------------------------------

/**
 * THE TEMPLATE THIS FILLS. Register this body, with these slots, IN THIS ORDER
 * (Meta: WhatsApp Manager -> Message templates; a BSP has its own screen), then
 * put the approved template's name in WHATSAPP_TPL_DAILY_REPORT:
 *
 *   Jeeva Hospital - report for {{1}}
 *   Collected Rs {{2}} (cash Rs {{3}})
 *   Billed Rs {{4}}, outstanding Rs {{5}}
 *   OP {{6}}, admissions {{7}}, discharges {{8}}
 *   Pharmacy Rs {{9}}, lab tests {{10}}
 *
 * Category: UTILITY - this is an account update to the hospital's own staff, not
 * marketing, and the wrong category is the usual reason a template is rejected.
 *
 * NO NEWLINES, TABS OR RUNS OF SPACES INSIDE A VALUE. Meta rejects a parameter
 * containing any of them, which is exactly why the whole report cannot be
 * poured into a single variable and why this list is scalars.
 */
export function whatsappReportVars(r: DailyReport): string[] {
  return [
    dayLabel(r.date),
    rs(r.money.net),
    rs(r.money.cash),
    rs(r.billing.billed),
    rs(r.billing.dueTotal),
    String(r.opd.booked),
    String(r.ipd.admissions),
    String(r.ipd.closures),
    rs(r.pharmacy.sales),
    String(r.lab.ordered),
  ];
}

/**
 * The same summary as one readable message.
 *
 * Used for the log line when no template is registered yet, and as the actual
 * body on the free-text path (WHATSAPP_ALLOW_FREE_TEXT=on, inside the 24-hour
 * window). Kept short on purpose - this is read on a phone, and the detail is
 * one tap away in the mail.
 */
export function renderWhatsAppText(r: DailyReport): string {
  const L: string[] = [];
  L.push(`*${r.hospital.name}* - ${dayLabel(r.date)}`);
  L.push("");
  L.push(`Collected: *Rs ${rs(r.money.net)}*  (cash Rs ${rs(r.money.cash)})`);
  L.push(`Billed: Rs ${rs(r.billing.billed)} in ${r.billing.billCount} bill${r.billing.billCount === 1 ? "" : "s"}`);
  L.push(`Outstanding: Rs ${rs(r.billing.dueTotal)}`);
  if (r.money.insuranceAmount > 0) L.push(`To insurers: Rs ${rs(r.money.insuranceAmount)}`);
  L.push("");
  L.push(`OP ${r.opd.booked} (done ${r.opd.completed}) · new ${r.opd.newPatients}`);
  L.push(`Ward: ${r.ipd.admissions} in, ${r.ipd.closures} out, ${r.ipd.inHouse} in house (${r.ipd.beds.occupied}/${r.ipd.beds.total} beds)`);
  L.push(`Lab: ${r.lab.ordered} ordered, ${r.lab.pending} pending`);
  L.push(`Pharmacy: Rs ${rs(r.pharmacy.sales)} · profit Rs ${rs(r.pharmacy.profit)}`);
  if (r.alerts.length) {
    L.push("");
    L.push("*Needs attention*");
    for (const a of r.alerts) L.push(`• ${a}`);
  }
  return L.join("\n");
}

/** Subject line. Carries the two numbers worth seeing without opening the mail. */
export function reportSubject(r: DailyReport): string {
  return `${r.hospital.name} · ${dayLabel(r.date)} · collected ₹${rs(r.money.net)}, cash ₹${rs(r.money.cash)}`;
}
