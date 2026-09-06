import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { rs, dayLabel, type DailyReport } from "./daily-report";
import { amountInWords } from "./amount-words";
import { GEIST_MONO_REGULAR_BASE64, GEIST_MONO_MEDIUM_BASE64 } from "@/server/assets/fonts/geist-mono";

/**
 * THE DAILY REPORT AS PAPER - the copy that gets forwarded, printed and filed.
 *
 * ─── WHY IT EXISTS ALONGSIDE THE HTML MAIL ─────────────────────────────────
 * The HTML body is what an owner reads on a phone at 9:30 PM. This is what goes
 * to the CA, gets printed for a file, or settles a month-end argument - none of
 * which a mail body can do without being re-rendered by whichever client opens
 * it. Both come from ONE DailyReport object, so the attachment can never
 * disagree with the mail it is attached to.
 *
 * ─── IT IS THE DAY-CLOSE STATEMENT'S SHEET ─────────────────────────────────
 * Same decisions as components/print/day-close-sheet.tsx, for the same reasons:
 *
 *   MONO THROUGHOUT. Geist Mono, the face that sheet prints in. A column of
 *   rupees only scans if every digit is the same width.
 *
 *   400 AGAINST 500, NEVER A BOLD. Hierarchy comes from weight, uppercase and
 *   the rules. A synthesised bold at 9pt on the counter's laser is a smear.
 *
 *   ONE INK, NO COLOUR. A tint the office printer decides to drop takes the
 *   meaning with it, so a refund is readable by its leading minus and the
 *   column it sits in - not by being red.
 *
 * The rules are DOTTED here rather than the sheet's hairline, which is the one
 * deliberate departure.
 *
 * ─── NO RUPEE SIGN ─────────────────────────────────────────────────────────
 * Geist Mono's latin subset has no glyph at U+20B9 - checked, not assumed - so
 * every amount reads "Rs", exactly as the plain-text half of the mail already
 * does. Every string goes through glyphSafe() on the way in: a doctor's name
 * with an unusual character in it must never be the reason a night's report
 * fails to attach.
 */

// A4, in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

/** One ink, and two greys for the rules. Matches --pr-ink / --pr-line / --pr-hair. */
const INK: RGB = rgb(0.067, 0.067, 0.067);
const MUTED: RGB = rgb(0.247, 0.247, 0.247);
const LINE: RGB = rgb(0.612, 0.612, 0.612);
const HAIR: RGB = rgb(0.812, 0.812, 0.812);

/** The dotted rule this sheet is ruled with. */
const DOTS: number[] = [0.7, 2.1];

/**
 * Make a string drawable in Geist Mono's latin subset.
 *
 * The named replacements are the characters this report actually produces; the
 * final sweep drops anything else outside Latin-1 rather than letting it reach
 * the encoder, which THROWS on a glyph it cannot find. Silently losing an
 * exotic character is the right failure here - the alternative takes the whole
 * attachment with it.
 */
export function glyphSafe(s: string): string {
  return String(s)
    .replace(/₹/g, "Rs")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF·•–—−]/g, "");
}

interface Sheet {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  /** 400 - body. */
  reg: PDFFont;
  /** 500 - the emphasis this sheet uses instead of a bold. */
  med: PDFFont;
  pages: PDFPage[];
}

function newPage(s: Sheet): void {
  s.page = s.doc.addPage([PAGE_W, PAGE_H]);
  s.pages.push(s.page);
  s.y = PAGE_H - MARGIN;
}

/** Break to a new page when the next block would not clear the footer. */
function need(s: Sheet, height: number): void {
  if (s.y - height < MARGIN + 30) newPage(s);
}

function put(
  s: Sheet,
  str: string,
  o: { x?: number; size?: number; color?: RGB; med?: boolean; rightAt?: number; y?: number }
): void {
  const size = o.size ?? 8.6;
  const font = o.med ? s.med : s.reg;
  const t = glyphSafe(str);
  const x = o.rightAt !== undefined ? o.rightAt - font.widthOfTextAtSize(t, size) : (o.x ?? MARGIN);
  s.page.drawText(t, { x, y: o.y ?? s.y, size, font, color: o.color ?? INK });
}

function dotted(s: Sheet, y: number, opts?: { color?: RGB; thickness?: number }): void {
  s.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: RIGHT, y },
    thickness: opts?.thickness ?? 0.5,
    color: opts?.color ?? HAIR,
    dashArray: DOTS,
  });
}

/** A section heading: small, uppercase, tracked by a dotted rule beneath it. */
function heading(s: Sheet, label: string): void {
  need(s, 46);
  s.y -= 20;
  put(s, label.toUpperCase(), { size: 7.2, med: true, color: MUTED });
  s.y -= 5;
  dotted(s, s.y, { color: LINE, thickness: 0.6 });
  s.y -= 3;
}

/** One label/value line with a dotted rule under it. Value right-aligned. */
function row(s: Sheet, label: string, value: string, o?: { med?: boolean }): void {
  need(s, 18);
  s.y -= 12;
  put(s, label, { size: 8.4, color: MUTED });
  put(s, value, { size: 8.6, med: o?.med, rightAt: RIGHT });
  s.y -= 4;
  dotted(s, s.y);
}

export async function renderReportPdf(r: DailyReport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(glyphSafe(`${r.hospital.name} - daily report ${r.date}`));
  doc.setSubject(glyphSafe(`Collections, billing, ward, lab and pharmacy for ${dayLabel(r.date)}`));
  doc.setProducer("Jeeva HMS");
  doc.setCreationDate(new Date(r.generatedAt));

  const reg = await doc.embedFont(Buffer.from(GEIST_MONO_REGULAR_BASE64, "base64"), { subset: true });
  const med = await doc.embedFont(Buffer.from(GEIST_MONO_MEDIUM_BASE64, "base64"), { subset: true });

  const s: Sheet = { doc, page: null as unknown as PDFPage, y: 0, reg, med, pages: [] };
  newPage(s);

  // ── masthead ────────────────────────────────────────────────────────────
  s.y -= 12;
  put(s, r.hospital.name.toUpperCase(), { size: 11, med: true });
  put(s, dayLabel(r.date), { size: 9, med: true, rightAt: RIGHT });
  s.y -= 11;
  put(s, "DAILY REPORT", { size: 7.2, color: MUTED });
  put(s, "ALL COUNTERS", { size: 7.2, color: MUTED, rightAt: RIGHT });
  s.y -= 7;
  dotted(s, s.y, { color: LINE, thickness: 0.8 });
  s.y -= 2.5;
  dotted(s, s.y, { color: LINE, thickness: 0.8 });

  // ── the two numbers the sheet exists for ────────────────────────────────
  //
  // The day-close statement leads with the one number a receptionist physically
  // counts. A whole-hospital report has two: what came in, and how much of it
  // is cash somebody is holding right now.
  s.y -= 17;
  put(s, "COLLECTED AT ALL COUNTERS", { size: 7.4, color: MUTED });
  put(s, `Rs ${rs(r.money.net)}`, { size: 15, med: true, rightAt: RIGHT });
  s.y -= 12;
  put(s, "Collected less refunded. Insurer billing is not counted here.", { size: 7.2, color: MUTED });
  s.y -= 12;
  put(s, "CASH THAT SHOULD BE IN THE DRAWERS", { size: 7.4, color: MUTED });
  put(s, `Rs ${rs(r.money.cash)}`, { size: 15, med: true, rightAt: RIGHT });
  s.y -= 12;
  // Words, for the same reason the day-close sheet carries them: a figure that
  // has been altered by a pen does not match its own words. NOT prefixed with
  // "Rupees" - amountInWords already ends "... Rupees Only", and prefixing it
  // prints the word twice.
  put(s, amountInWords(r.money.cash), { size: 7.2, color: MUTED });
  s.y -= 8;
  dotted(s, s.y, { color: LINE, thickness: 0.8 });

  // ── money ───────────────────────────────────────────────────────────────
  heading(s, "Money");
  row(s, "Collected at counters", `Rs ${rs(r.money.collected)}`);
  row(s, "Refunded", r.money.refunded > 0 ? `- Rs ${rs(r.money.refunded)}` : "-");
  row(s, "Net", `Rs ${rs(r.money.net)}`, { med: true });
  row(s, "Tenders taken", String(r.money.payments));
  row(s, "Bills raised (counter)", String(r.money.bills));
  row(s, "Billed to insurers today", `${r.money.insuranceBills} bill${r.money.insuranceBills === 1 ? "" : "s"}  ·  Rs ${rs(r.money.insuranceAmount)}`);
  row(s, "Insurer settlements banked", `Rs ${rs(r.money.insurerReceipts)}`);

  heading(s, "By counter");
  for (const t of r.money.tills) {
    row(s, t.label, `cash Rs ${rs(t.cash)}  ·  digital Rs ${rs(t.digital)}  ·  net Rs ${rs(t.net)}`);
  }

  heading(s, "By payment type");
  const modes = r.money.modes.filter((m) => m.collected > 0 || m.refunded > 0);
  if (modes.length === 0) row(s, "Nothing collected today", "-");
  for (const m of modes) {
    const back = m.refunded > 0 ? `  ·  back Rs ${rs(m.refunded)}` : "";
    row(s, m.mode, `${m.count} tender${m.count === 1 ? "" : "s"}  ·  Rs ${rs(m.collected)}${back}  ·  net Rs ${rs(m.net)}`);
  }

  heading(s, "What the money was for");
  const sources = r.money.bySource.filter((x) => x.net !== 0);
  if (sources.length === 0) row(s, "No counter takings today", "-");
  for (const x of sources) row(s, x.source, `${x.count}  ·  Rs ${rs(x.net)}`);

  // ── billing ─────────────────────────────────────────────────────────────
  heading(s, "Billing");
  row(s, "Billed today", `${r.billing.billCount} bill${r.billing.billCount === 1 ? "" : "s"}  ·  Rs ${rs(r.billing.billed)}`);
  row(s, "Discount given", `Rs ${rs(r.billing.discountGiven)}`);
  row(s, "Cancelled bills", `${r.billing.cancelled}  ·  Rs ${rs(r.billing.cancelledValue)}`);
  row(s, "Unpaid from today", `Rs ${rs(r.billing.dueFromToday)}`);
  row(s, "Outstanding, all dates (self-pay)", `Rs ${rs(r.billing.dueTotal)}`, { med: true });

  // ── patients ────────────────────────────────────────────────────────────
  heading(s, "Outpatient");
  row(s, "Appointments", String(r.opd.booked));
  row(s, "Completed", String(r.opd.completed));
  row(s, "Cancelled", String(r.opd.cancelled));
  row(s, "New patients registered", String(r.opd.newPatients));

  heading(s, "Ward");
  row(s, "Admissions", String(r.ipd.admissions));
  const closures = r.ipd.closureKinds
    .map((k) => `${k.count} ${k.status.toLowerCase().replace(/_/g, " ")}`)
    .join(", ");
  row(s, "Stays closed", closures ? `${r.ipd.closures}  ·  ${closures}` : String(r.ipd.closures));
  row(s, "In house now", String(r.ipd.inHouse));
  row(s, "Beds", `${r.ipd.beds.occupied} of ${r.ipd.beds.total} occupied  ·  ${r.ipd.beds.free} free`);
  row(s, "Deposits taken", `${r.ipd.advanceCount}  ·  Rs ${rs(r.ipd.advances)}`);

  heading(s, "Laboratory");
  row(s, "Tests ordered", String(r.lab.ordered));
  row(s, "Completed", String(r.lab.completed));
  row(s, "Pending, all days", String(r.lab.pending));

  heading(s, "Pharmacy");
  row(s, "Sales", `${r.pharmacy.billCount} bill${r.pharmacy.billCount === 1 ? "" : "s"}  ·  Rs ${rs(r.pharmacy.sales)}`);
  row(s, "Profit", `Rs ${rs(r.pharmacy.profit)}  ·  ${r.pharmacy.marginPct}% margin`);
  row(s, "At or below reorder level", String(r.pharmacy.lowStock));
  row(s, "Out of stock", String(r.pharmacy.outOfStock));
  row(s, "Expiring soon", String(r.pharmacy.expiringSoon));

  heading(s, "Doctors");
  if (r.doctors.length === 0) row(s, "No consultation or ward billing today", "-");
  for (const d of r.doctors) {
    row(s, `${d.doctor}  ·  ${d.department}`, `${d.visits} visit${d.visits === 1 ? "" : "s"}  ·  Rs ${rs(d.revenue)}`);
  }

  heading(s, "Insurance");
  row(s, "Claims raised", `${r.insurance.claimsRaised}  ·  Rs ${rs(r.insurance.claimsRaisedValue)}`);
  row(s, "Claims settled", `${r.insurance.claimsSettled}  ·  Rs ${rs(r.insurance.claimsSettledValue)}`);

  // ── what to act on ──────────────────────────────────────────────────────
  if (r.alerts.length) {
    need(s, 30 + r.alerts.length * 12);
    heading(s, "Needs attention");
    for (const a of r.alerts) {
      s.y -= 12;
      put(s, `-  ${a}`, { size: 8.4 });
    }
    s.y -= 5;
    dotted(s, s.y, { color: LINE, thickness: 0.6 });
  }

  // ── footer, on every page ───────────────────────────────────────────────
  //
  // Written last, once the page count is known. The provenance line matters
  // more than it looks: a report generated at 9:30 PM is not a closed day, and
  // the counter figures are the day-close screen's own, not a second opinion.
  // Hand-formatted for the same reason dayLabel is: toLocaleString renders
  // September as "Sep" on one Node build and "Sept" on another, and a footer
  // that changes shape with the runtime undermines the numbers above it.
  const gen = new Date(r.generatedAt);
  const hh = String(gen.getHours()).padStart(2, "0");
  const mm = String(gen.getMinutes()).padStart(2, "0");
  const stamp = glyphSafe(
    `Generated ${dayLabel(`${gen.getFullYear()}-${String(gen.getMonth() + 1).padStart(2, "0")}-${String(gen.getDate()).padStart(2, "0")}`)} ${hh}:${mm}  ·  ` +
    `counter figures match the day-close statement for the same date  ·  amounts in rupees`
  );

  s.pages.forEach((p, i) => {
    p.drawLine({
      start: { x: MARGIN, y: MARGIN + 20 },
      end: { x: RIGHT, y: MARGIN + 20 },
      thickness: 0.5,
      color: HAIR,
      dashArray: DOTS,
    });
    p.drawText(stamp, { x: MARGIN, y: MARGIN + 10, size: 6.4, font: reg, color: MUTED });
    const n = `${i + 1} / ${s.pages.length}`;
    p.drawText(n, {
      x: RIGHT - reg.widthOfTextAtSize(n, 6.4),
      y: MARGIN + 10,
      size: 6.4,
      font: reg,
      color: MUTED,
    });
  });

  return doc.save();
}

/** The filename an owner sees in their inbox and their downloads folder. */
export function reportPdfFilename(r: DailyReport): string {
  return `jeeva-daily-report-${r.date}.pdf`;
}
