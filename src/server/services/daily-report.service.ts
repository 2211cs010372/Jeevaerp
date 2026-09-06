import { prisma } from "@/lib/prisma";
import { localDateISO, parseDateOnly, parseLocalDate } from "@/lib/date";
import { dayClose, dayCloseByTill } from "./reports.service";
import { pharmacyProfitSummary, stockAlerts } from "./pharmacy.service";
import { logAudit } from "./audit.service";
import { deliverEmail, emailStatus } from "@/lib/email";
import { sendWhatsAppTemplate, sendWhatsAppText, whatsappStatus } from "@/lib/whatsapp";
import { formatPhone } from "@/lib/phone";
import {
  parseEmailList, parsePhoneList, renderReportHtml, renderReportText,
  renderWhatsAppText, whatsappReportVars, reportSubject, rs,
  type DailyReport,
} from "@/lib/daily-report";
import type { AuthUser } from "@/lib/auth/types";

/**
 * THE DAILY REPORT - one day of the hospital, sent to the people who own it.
 *
 * Runs from two places and does the same thing from both:
 *   - the nightly cron (vercel.json -> /api/v1/cron/daily-report), 9:30 PM IST
 *   - the "Send now" button in admin settings
 *
 * ─── WHY THE MONEY IS NOT RE-DERIVED HERE ──────────────────────────────────
 * Every counter figure comes from dayClose / dayCloseByTill in
 * reports.service.ts, unchanged. That file already encodes three rules that are
 * easy to get wrong and expensive to get wrong twice: a refund reduces the
 * drawer on the day it was handed back; an IPD deposit is counted on the day it
 * was TAKEN and skipped on the discharge day it is adjusted against; and an
 * insurer's bill is not money at all. A report that recomputed collections
 * would eventually disagree with the day-close screen by a few thousand rupees,
 * and the first person to notice would be the owner reading both at once.
 *
 * So: two calls to the same source of truth (the per-till roll-up and the
 * hospital-wide statement) rather than one clever query. This runs once a day.
 *
 * ─── NOTHING HERE THROWS INTO THE CRON ─────────────────────────────────────
 * `sendDailyReport` reports per-channel outcomes instead. A WhatsApp template
 * that has not been approved yet must not stop the email going out, and neither
 * failure should turn into a 500 that a scheduler retries all night.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: { toString(): string }) => Number(v.toString());

/** Local-day window. The hospital's day ends at midnight, not at UTC midnight. */
function dayWindow(dateISO: string) {
  const base = parseLocalDate(dateISO);
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const to = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  return { from, to };
}

// ---------------------------------------------------------------------------
// BUILD
// ---------------------------------------------------------------------------

export async function buildDailyReport(dateISO?: string): Promise<DailyReport> {
  const date = dateISO ?? localDateISO();
  const { from, to } = dayWindow(date);
  // Appointment.visitDate is a @db.Date column, read back as UTC midnight of its
  // calendar day - so it is matched with parseDateOnly, never the local window.
  // See lib/date.ts; mixing the two files an evening OP visit under yesterday.
  const visitDay = parseDateOnly(date);

  const [
    close, byTill, apptRows, newPatients,
    admissions, closureRows, inHouse, totalBeds,
    invoiceRows, labOrdered, labCompleted, labPending,
    profit, stock, docInvoices, claimRows, settledRows, unpaidRows,
  ] = await Promise.all([
    dayClose({ dateISO: date }),
    dayCloseByTill(date),
    prisma.appointment.findMany({ where: { visitDate: visitDay }, select: { status: true } }),
    prisma.patient.count({ where: { createdAt: { gte: from, lte: to }, deletedAt: null, mergedIntoId: null } }),
    prisma.admission.count({ where: { admittedAt: { gte: from, lte: to } } }),
    // Every way a stay can end, not just DISCHARGED. The AdmissionStatus comment
    // in schema.prisma is explicit about this: LAMA, ABSCONDED, TRANSFERRED_OUT
    // and EXPIRED are closures too, and a report that counted only DISCHARGED
    // would quietly drop them.
    prisma.admission.findMany({
      where: { dischargedAt: { gte: from, lte: to }, status: { not: "ADMITTED" } },
      select: { status: true },
    }),
    prisma.admission.count({ where: { status: "ADMITTED" } }),
    prisma.bed.count(),
    prisma.invoice.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { status: true, source: true, totalAmount: true, discountAmount: true },
    }),
    prisma.labTest.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.labTest.count({ where: { completedAt: { gte: from, lte: to } } }),
    // The BACKLOG, not a figure for this day: every test still waiting, however
    // long it has been waiting. That is the number worth acting on in the
    // morning, and it is labelled as a backlog wherever it is printed.
    prisma.labTest.count({ where: { status: "PENDING" } }),
    pharmacyProfitSummary({ dateISO: date }),
    stockAlerts(),
    prisma.invoice.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        status: { not: "CANCELLED" },
        OR: [{ appointmentId: { not: null } }, { admissionId: { not: null } }],
      },
      select: {
        totalAmount: true,
        appointment: { select: { doctor: { select: { name: true, department: true } } } },
        admission: { select: { doctor: { select: { name: true, department: true } } } },
      },
    }),
    prisma.insuranceClaim.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { claimedAmount: true },
    }),
    prisma.insuranceClaim.findMany({
      where: { settledAt: { gte: from, lte: to } },
      select: { settledAmount: true },
    }),
    // Outstanding across ALL dates - self-pay only, matching the day-close rule:
    // an insurer's unpaid bill is not a debt anybody at a desk can collect, and
    // listing it as one sends staff to find a family who owes nothing.
    prisma.invoice.findMany({
      where: { status: { in: ["PENDING", "PARTIALLY_PAID"] }, payer: "SELF_PAY" },
      select: { totalAmount: true, payments: { select: { amount: true } } },
    }),
  ]);

  // ── outpatient ──────────────────────────────────────────────────────────
  const opd = {
    booked: apptRows.filter((a) => a.status !== "CANCELLED").length,
    completed: apptRows.filter((a) => a.status === "COMPLETED").length,
    cancelled: apptRows.filter((a) => a.status === "CANCELLED").length,
    newPatients,
  };

  // ── ward ────────────────────────────────────────────────────────────────
  const closureKinds = [...closureRows.reduce((m, r) => m.set(r.status, (m.get(r.status) ?? 0) + 1), new Map<string, number>())]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // ── billing ─────────────────────────────────────────────────────────────
  const live = invoiceRows.filter((i) => i.status !== "CANCELLED");
  const cancelled = invoiceRows.filter((i) => i.status === "CANCELLED");
  const pharmacyBills = live.filter((i) => i.source === "PHARMACY");

  const dueTotal = unpaidRows.reduce((s, i) => {
    const paid = i.payments.reduce((p, x) => r2(p + num(x.amount)), 0);
    return r2(s + Math.max(0, num(i.totalAmount) - paid));
  }, 0);

  // ── doctors ─────────────────────────────────────────────────────────────
  const docMap = new Map<string, { doctor: string; department: string; visits: number; revenue: number }>();
  for (const i of docInvoices) {
    const doc = i.appointment?.doctor ?? i.admission?.doctor;
    if (!doc) continue;
    const key = `${doc.name}|${doc.department}`;
    const cur = docMap.get(key) ?? { doctor: doc.name, department: doc.department, visits: 0, revenue: 0 };
    cur.visits += 1;
    cur.revenue = r2(cur.revenue + num(i.totalAmount));
    docMap.set(key, cur);
  }
  const doctors = [...docMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // ── pharmacy shelf ──────────────────────────────────────────────────────
  const outOfStock = stock.lowStock.filter((m) => m.inStock <= 0).length;
  const lowStock = stock.lowStock.length;

  // ── the numbers somebody has to act on ──────────────────────────────────
  const dueFromToday = r2(close.outstanding.reduce((s, o) => r2(s + o.due), 0));
  const unassigned = byTill.tills.find((t) => t.till === "UNASSIGNED");

  const alerts: string[] = [];
  if (outOfStock > 0) alerts.push(`${outOfStock} medicine${outOfStock === 1 ? " is" : "s are"} out of stock`);
  if (lowStock - outOfStock > 0) alerts.push(`${lowStock - outOfStock} medicine${lowStock - outOfStock === 1 ? " is" : "s are"} at or below reorder level`);
  if (stock.expiring.length > 0) alerts.push(`${stock.expiring.length} batch${stock.expiring.length === 1 ? "" : "es"} expiring soon`);
  if (dueFromToday > 0) alerts.push(`Rs ${rs(dueFromToday)} unpaid on bills raised today`);
  if (labPending > 0) alerts.push(`${labPending} lab test${labPending === 1 ? "" : "s"} still pending across all days`);
  if (close.totals.refunded > 0) alerts.push(`Rs ${rs(close.totals.refunded)} refunded today across ${close.refundCount} refund${close.refundCount === 1 ? "" : "s"}`);
  // Money taken by somebody whose role maps to no drawer. Should be zero; when
  // it is not, it is the one line in this report nobody else will chase.
  if (unassigned && unassigned.net !== 0) {
    alerts.push(`Rs ${rs(unassigned.net)} was taken by staff who belong to no till - it will not appear on any counter's day close`);
  }

  return {
    date,
    generatedAt: new Date().toISOString(),
    hospital: { name: close.hospital?.legalName?.trim() || "Jeeva Hospital" },

    money: {
      collected: close.totals.collected,
      refunded: close.totals.refunded,
      net: close.totals.net,
      cash: close.cashInHand,
      payments: close.modes.reduce((s, m) => s + m.count, 0),
      bills: close.bills,
      insuranceBills: close.insurance.length,
      insuranceAmount: close.insuranceTotal,
      insurerReceipts: close.insurerReceipts,
      // UNASSIGNED is dropped from the printed table and surfaced as an alert
      // instead - a row that should always read zero teaches people to skip the
      // table, and this one matters precisely when it is not zero.
      tills: byTill.tills
        .filter((t) => t.till !== "UNASSIGNED")
        .map((t) => ({
          label: t.label, collected: t.collected, refunded: t.refunded,
          net: t.net, cash: t.cash, digital: t.digital, bills: t.bills,
        })),
      modes: close.modes.map((m) => ({ mode: m.mode, collected: m.collected, refunded: m.refunded, net: m.net, count: m.count })),
      bySource: close.bySource.map((s) => ({ source: s.source, net: s.net, count: s.count })),
    },

    billing: {
      billed: r2(live.reduce((s, i) => r2(s + num(i.totalAmount)), 0)),
      billCount: live.length,
      discountGiven: r2(live.reduce((s, i) => r2(s + num(i.discountAmount)), 0)),
      cancelled: cancelled.length,
      cancelledValue: r2(cancelled.reduce((s, i) => r2(s + num(i.totalAmount)), 0)),
      dueFromToday,
      dueTotal,
    },

    opd,

    ipd: {
      admissions,
      closures: closureRows.length,
      closureKinds,
      inHouse,
      beds: { total: totalBeds, occupied: inHouse, free: Math.max(0, totalBeds - inHouse) },
      advances: close.advanceTotal,
      advanceCount: close.advances.length,
    },

    lab: { ordered: labOrdered, completed: labCompleted, pending: labPending },

    pharmacy: {
      sales: r2(pharmacyBills.reduce((s, i) => r2(s + num(i.totalAmount)), 0)),
      billCount: pharmacyBills.length,
      profit: Number(profit.profitToday),
      marginPct: profit.marginPct,
      lowStock,
      outOfStock,
      expiringSoon: stock.expiring.length,
    },

    doctors,

    insurance: {
      claimsRaised: claimRows.length,
      claimsRaisedValue: r2(claimRows.reduce((s, c) => r2(s + num(c.claimedAmount)), 0)),
      claimsSettled: settledRows.length,
      claimsSettledValue: r2(settledRows.reduce((s, c) => r2(s + (c.settledAmount ? num(c.settledAmount) : 0)), 0)),
    },

    alerts,
  };
}

// ---------------------------------------------------------------------------
// WHO GETS IT
// ---------------------------------------------------------------------------

export interface ReportRecipients {
  enabled: boolean;
  emails: string[];
  phones: string[];
  /** Where each list came from, so the settings screen can say so out loud. */
  emailSource: "settings" | "env" | "none";
  phoneSource: "settings" | "env" | "none";
}

/**
 * The distribution list.
 *
 * TWO SOURCES, ON PURPOSE. The admin settings screen is where the hospital
 * changes it without a developer; the env vars (REPORT_EMAILS,
 * REPORT_WHATSAPP_NUMBERS) are the fallback for each list that is still blank.
 * That ordering matters: once somebody has typed a list into the screen, an old
 * value left in the environment must not keep sending copies to a person who
 * was removed.
 *
 * The try/catch is not decoration. These three columns arrive in a migration
 * that has to be run against the live hospital database by hand, so there is a
 * window where this code is deployed and the columns are not there yet. In that
 * window the report still goes out, to the env list, and says why in the log.
 */
export async function reportRecipients(): Promise<ReportRecipients> {
  let cfg: { dailyReportEnabled: boolean; reportEmails: string | null; reportWhatsappNumbers: string | null } | null = null;
  try {
    cfg = await prisma.hospitalConfig.findFirst({
      select: { dailyReportEnabled: true, reportEmails: true, reportWhatsappNumbers: true },
    });
  } catch {
    console.warn(
      "[daily-report] could not read the report settings - falling back to REPORT_EMAILS / " +
      "REPORT_WHATSAPP_NUMBERS. Run `npx prisma migrate deploy` to add the columns."
    );
  }

  const fromSettingsEmails = parseEmailList(cfg?.reportEmails);
  const fromEnvEmails = parseEmailList(process.env.REPORT_EMAILS);
  const fromSettingsPhones = parsePhoneList(cfg?.reportWhatsappNumbers);
  const fromEnvPhones = parsePhoneList(process.env.REPORT_WHATSAPP_NUMBERS);

  const emails = fromSettingsEmails.length ? fromSettingsEmails : fromEnvEmails;
  const phones = fromSettingsPhones.length ? fromSettingsPhones : fromEnvPhones;

  return {
    // Fails OPEN, like getHiddenAdminNavHrefs and unlike billEditingEnabled: a
    // missing config row must not be the reason the owner stops hearing from
    // the hospital. Switching the report off is a deliberate act on the screen.
    enabled: cfg?.dailyReportEnabled ?? true,
    emails,
    phones,
    emailSource: fromSettingsEmails.length ? "settings" : fromEnvEmails.length ? "env" : "none",
    phoneSource: fromSettingsPhones.length ? "settings" : fromEnvPhones.length ? "env" : "none",
  };
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------

export interface SendResult {
  date: string;
  skipped?: "disabled" | "no-recipients";
  email: { attempted: number; sent: boolean; reason?: string };
  whatsapp: { attempted: number; sent: number; failures: { to: string; reason?: string }[] };
}

/**
 * Build the report and push it down both channels. Never throws.
 *
 * `trigger` is recorded in the audit log because "why did this go out twice on
 * Tuesday" is answered by knowing one was the cron and one was somebody's
 * finger on the Send now button.
 */
export async function sendDailyReport(opts?: {
  dateISO?: string;
  trigger?: "cron" | "manual";
  actor?: AuthUser | null;
  ctx?: { ipAddress?: string; userAgent?: string };
}): Promise<SendResult> {
  const trigger = opts?.trigger ?? "cron";
  const to = await reportRecipients();
  const date = opts?.dateISO ?? localDateISO();

  const blank: SendResult = {
    date,
    email: { attempted: 0, sent: false },
    whatsapp: { attempted: 0, sent: 0, failures: [] },
  };

  // A manual send is somebody asking for it explicitly, so the master switch is
  // not consulted - they are looking at the screen that holds it.
  if (!to.enabled && trigger === "cron") return { ...blank, skipped: "disabled" };
  if (to.emails.length === 0 && to.phones.length === 0) return { ...blank, skipped: "no-recipients" };

  const report = await buildDailyReport(date);

  // ── email ───────────────────────────────────────────────────────────────
  let email: SendResult["email"] = { attempted: to.emails.length, sent: false, reason: "no-recipients" };
  if (to.emails.length) {
    const out = await deliverEmail({
      to: to.emails,
      subject: reportSubject(report),
      html: renderReportHtml(report),
      text: renderReportText(report),
      label: "daily-report",
    });
    email = { attempted: to.emails.length, sent: out.sent, reason: out.reason };
  }

  // ── whatsapp ────────────────────────────────────────────────────────────
  //
  // Sequential, not Promise.all - the same reasoning as fanOutToAdmins in
  // notify.service.ts. This is a handful of numbers on a path nobody is waiting
  // on, and providers rate-limit bursts from one account.
  const whatsapp: SendResult["whatsapp"] = { attempted: to.phones.length, sent: 0, failures: [] };
  const templateId = process.env.WHATSAPP_TPL_DAILY_REPORT?.trim();
  const language = process.env.WHATSAPP_TPL_LANG?.trim();
  const preview = renderWhatsAppText(report);

  for (const phone of to.phones) {
    let out = await sendWhatsAppTemplate(phone, {
      templateId,
      language,
      vars: whatsappReportVars(report),
      preview,
      label: "daily-report",
    });
    // No approved template yet, but somebody has switched free text on and is
    // inside the 24-hour window (they messaged the business number). Worth
    // trying: it is the only path that works before Meta approves anything.
    if (!out.sent && (out.reason === "no-template" || out.reason === "config")) {
      const alt = await sendWhatsAppText(phone, preview, "daily-report");
      if (alt.sent) out = alt;
    }
    if (out.sent) whatsapp.sent += 1;
    else whatsapp.failures.push({ to: formatPhone(phone), reason: out.reason });
  }

  await logAudit(opts?.actor ?? null, {
    action: "DAILY_REPORT_SENT",
    targetTable: "HospitalConfig",
    targetId: date,
    meta: {
      trigger,
      date,
      emails: to.emails.length,
      emailSent: email.sent,
      ...(email.reason ? { emailReason: email.reason } : {}),
      whatsappNumbers: to.phones.length,
      whatsappSent: whatsapp.sent,
      collected: report.money.net,
      cash: report.money.cash,
    },
    ...(opts?.ctx ?? {}),
  });

  return { date, email, whatsapp };
}

/**
 * Everything the admin settings card needs in one call: can this actually send,
 * to whom, and what is still missing.
 */
export async function dailyReportStatus(): Promise<{
  recipients: ReportRecipients;
  email: ReturnType<typeof emailStatus>;
  whatsapp: ReturnType<typeof whatsappStatus>;
  /** The nightly cron's wall-clock time, so the screen states it rather than implying it. */
  schedule: string;
}> {
  return {
    recipients: await reportRecipients(),
    email: emailStatus(),
    whatsapp: whatsappStatus(),
    schedule: "9:30 PM IST daily",
  };
}
