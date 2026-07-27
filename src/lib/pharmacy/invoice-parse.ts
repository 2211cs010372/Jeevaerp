/**
 * Reading a distributor's GST invoice.
 *
 * Pure parsing, deliberately outside the React component: this is the part that
 * can be wrong in ways nobody notices until a batch is booked against the wrong
 * company or a wrong expiry reaches the shelf. It is tested against the RAW OCR
 * of a real Vishwanath Medical Stores invoice (tests/fixtures), noise included.
 *
 * Nothing here is trusted. Every value is a SUGGESTION that lands in a form
 * field for the pharmacist to confirm - OCR misreads digits, and a misread digit
 * in a batch number or an expiry is a patient-safety problem, not a typo.
 *
 * THE LAYOUT. Indian pharma invoices print one fixed column order:
 *
 *   SNO · PRODUCT NAME · PACK · QTY · FREE · OMrp · BATCH · M.R.P · EXP ·
 *   RATE · AMOUNT · G% · HSN
 *
 * Only PRODUCT NAME has a variable width, and FREE is usually blank. So the
 * columns are read RIGHT TO LEFT from HSN, which is the most reliable anchor on
 * the line - a 6-digit code in a fixed position. Anchoring on the MM/YY expiry
 * instead breaks the moment a product name contains a number, and these are
 * full of them: "ISTAMET 50/500", "TELMA CT40/6.25MG", "ECOSPRIN AV 75/20".
 */

/** One line item read off an invoice, in the shape the import grid uses. */
export interface ParsedRow {
  medicine: string;
  /** Strip/bottle size as printed: "15T", "200ML", "5S". */
  pack: string;
  qty: string;
  /** Free goods - real stock carrying no invoice value. Usually blank. */
  free: string;
  /** The OMrp column. Holds the manufacturer's short code on these invoices. */
  oMrp: string;
  batchNo: string;
  /** Printed MRP - what the patient is billed at. */
  mrp: string;
  expiry: string;
  /** Purchase rate per unit - what the hospital pays. */
  rate: string;
  amount: string;
  gst: string;
  hsn: string;
  supplier: string;
  createNew?: boolean;
}

export interface SupplierRef { id: string; name: string }

/** The header block: who sent it, its number, its date and what it totals. */
export interface ParsedInvoice {
  /** Matched against suppliers on file. Empty when nothing matched. */
  supplierId: string;
  /** The distributor's name exactly as printed - shown when no match is found. */
  supplierName: string;
  gstin: string;
  invoiceNo: string;
  invoiceDate: string;
  /** NetAmount - the figure actually payable, rounded, incl. GST. */
  netAmount: string;
  /** Taxable value before GST. */
  taxableAmount: string;
  rows: ParsedRow[];
}

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Whatever a supplier wrote, into YYYY-MM-DD.
 *
 * A bare MM/YY or MM/YYYY is an EXPIRY and means the END of that month - a strip
 * marked "06/27" is good through 30 June. Taking the 1st would pull stock off
 * the shelf up to a month early.
 */
export function toISODate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoLocal(v);
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m;
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/))) {
    const d = m[1], mo = m[2], y = m[3].length === 2 ? "20" + m[3] : m[3];
    if (+mo < 1 || +mo > 12) return "";
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{2,4})$/))) {
    const mo = Number(m[1]);
    if (mo < 1 || mo > 12) return "";
    const y = Number(m[2].length === 2 ? "20" + m[2] : m[2]);
    const last = new Date(y, mo, 0).getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : isoLocal(d);
}

/** OCR leaves table borders and stray punctuation glued to numbers. */
const clean = (s: string) => (s || "").replace(/[^\d.]/g, "");
const isNum = (s: string) => { const c = clean(s); return c !== "" && /^\d+(\.\d+)?$/.test(c); };
const isMonthYear = (s: string) => {
  const m = s.match(/^(\d{1,2})[/\-](\d{2,4})$/);
  return !!m && +m[1] >= 1 && +m[1] <= 12;
};

/**
 * One line of the item table.
 *
 * Returns null for anything that isn't an item row - headers, the bank line,
 * totals, and the forest of `|` border fragments OCR emits for empty cells.
 */
function parseLine(raw: string): ParsedRow | null {
  // Table borders become noise tokens; drop them before splitting.
  const line = raw.replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  if (line.length < 15) return null;

  const t = line.split(" ");
  if (t.length < 8) return null;

  // ---- anchor on HSN, the rightmost fixed-width field ----
  let hi = -1;
  for (let i = t.length - 1; i >= 6; i--) {
    if (/^\d{6}$/.test(clean(t[i]))) { hi = i; break; }
  }
  if (hi < 6) return null;

  const hsn = clean(t[hi]);
  const gst = clean(t[hi - 1]);
  // G% is a small integer. If it isn't, this line isn't an item row.
  if (!isNum(gst) || Number(gst) > 28) return null;

  const amount = clean(t[hi - 2]);
  const rate = clean(t[hi - 3]);
  if (!isNum(amount) || !isNum(rate)) return null;

  // EXP sits just left of RATE.
  const expTok = (t[hi - 4] ?? "").replace(/[^\d/\-]/g, "");
  if (!isMonthYear(expTok)) return null;
  const expiry = toISODate(expTok);
  if (!expiry) return null;

  const mrp = clean(t[hi - 5]);
  if (!isNum(mrp)) return null;

  const batchNo = (t[hi - 6] || "").replace(/[^A-Za-z0-9/-]/g, "");
  if (batchNo.length < 3) return null;

  // ---- leftward: OMrp, FREE, QTY, PACK, PRODUCT NAME ----
  // OMrp is a short alphabetic company code (ARIS, AVEN, U.S., GLEN, PFIZ).
  let cursor = hi - 6;
  let oMrp = "";
  const maybeCode = (t[hi - 7] ?? "").replace(/[^A-Za-z.]/g, "");
  if (maybeCode.length >= 2 && maybeCode.length <= 6) {
    oMrp = maybeCode;
    cursor = hi - 7;
  }

  // QTY, and FREE when present, are the numbers immediately left of OMrp.
  //
  // STRICTLY numeric, on the RAW token. `clean()` strips letters, so a pack of
  // "15T" reduces to "15" and looked like a quantity - which silently shifted
  // every column left: pack became qty, qty became free, and a 15-tablet strip
  // was received as 15 units of stock.
  const pureNum = (tok: string) => /^\d+(\.\d+)?$/.test(tok.replace(/[^\d.]/g, "")) && !/[A-Za-z]/.test(tok);
  const nums: { i: number; v: string }[] = [];
  for (let j = cursor - 1; j >= 1 && nums.length < 2; j--) {
    const tok = t[j];
    if (!tok || tok.trim() === "") continue;
    if (pureNum(tok)) nums.unshift({ i: j, v: clean(tok) });
    else break;                      // hit the pack or the name - stop
  }
  if (nums.length === 0) return null;
  let qty = nums[0].v;
  let free = nums.length > 1 ? nums[1].v : "";
  let firstNumIdx = nums[0].i;

  // PACK is the token before QTY: 15T, 200ML, 5S, 15`S, 10`s.
  const packRaw = (t[firstNumIdx - 1] ?? "").replace(/[^A-Za-z0-9`'’]/g, "");
  let pack = /^\d{1,4}[A-Za-z`'’]{0,4}$/.test(packRaw) ? packRaw.replace(/[^A-Za-z0-9]/g, "") : "";

  // OCR reads the pack's trailing letter as a digit - "15S" becomes "158",
  // "10T" becomes "107". The pack then looks like a number, gets taken as the
  // quantity, and the real quantity slides into FREE. A 15-tablet strip would
  // be received as 158 units.
  //
  // FREE is blank on almost every line of these invoices, so two numbers with
  // NO pack token beside them is far more likely to be [misread-pack, qty] than
  // a genuine free-goods line. Where free goods are real the pack is present
  // and legible (SUCRAFIL: pack 200ML, qty 2.5, free 0.5), so this cannot fire.
  // Guarded by shape: a pack is a whole number of 10 or more ("15S", "200ML",
  // "30T"). A leading "5" is a real quantity with real free goods beside it, so
  // requiring >= 10 keeps genuine free-goods lines intact.
  const looksLikePack = (v: string) => !v.includes(".") && Number(v) >= 10;
  if (!pack && nums.length > 1 && looksLikePack(nums[0].v)) {
    pack = nums[0].v;
    qty = nums[1].v;
    free = "";
    firstNumIdx = nums[1].i;
  }

  // Everything from after the serial number to the pack is the product name.
  const nameEnd = pack ? firstNumIdx - 1 : firstNumIdx;
  const nameStart = /^\d{1,3}$/.test(clean(t[0])) && clean(t[0]) !== "" ? 1 : 0;   // drop SNO
  const medicine = t.slice(nameStart, nameEnd)
    .join(" ")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[^A-Za-z0-9 .\-/%]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (medicine.length < 3) return null;

  return { medicine, pack, qty, free, oMrp, batchNo, mrp, expiry, rate, amount, gst, hsn, supplier: "" };
}

/** Every item row on the invoice. */
export function parseInvoiceText(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (const line of text.split("\n")) {
    const row = parseLine(line);
    if (row) out.push(row);
  }
  return out;
}

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The header: supplier, GSTIN, invoice number, date and the money.
 *
 * The supplier is MATCHED against distributors already on file, never created
 * from OCR text - a misread character would otherwise mint "Vishwanalh Medical
 * Stores" as a second distributor and split the ledger. The name as printed is
 * returned alongside, so the screen can say "this invoice says X, which isn't on
 * your list" rather than silently leaving the field blank.
 */
export function parseInvoiceHeader(text: string, suppliers: SupplierRef[]): ParsedInvoice {
  const head = text.slice(0, 1400);
  const flat = squash(head);

  // Longest name first: "Deccan Medico Agencies" must beat a supplier merely
  // called "Deccan" when both are on file.
  let supplierId = "";
  for (const sup of [...suppliers].sort((a, b) => b.name.length - a.name.length)) {
    const key = squash(sup.name);
    if (key.length >= 5 && flat.includes(key)) { supplierId = sup.id; break; }
  }
  if (!supplierId) {
    for (const sup of suppliers) {
      const first = squash(sup.name.split(/\s+/)[0] ?? "");
      if (first.length >= 5 && flat.includes(first)) { supplierId = sup.id; break; }
    }
  }

  // The masthead: the first line carrying several all-caps words, with the
  // "GST INVOICE" title that sits beside it stripped off.
  let supplierName = "";
  for (const line of head.split("\n").slice(0, 4)) {
    const cand = line.replace(/GST\s*INVOICE/i, "").replace(/[^A-Za-z .&-]/g, " ").replace(/\s+/g, " ").trim();
    if (cand.length >= 8 && (cand.match(/[A-Z]{2,}/g) ?? []).length >= 2) { supplierName = cand; break; }
  }

  const gstin = (head.match(/\bGSTIN\s*[:.\-]?\s*([0-9A-Z]{15})/i)?.[1] ?? "").toUpperCase();
  const invNo = head.match(/\b(?:bill\s*no|invoice\s*no|inv\s*no)\s*[:.\-#]*\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,24})/i);
  const invDate = head.match(/\bdate\s*[:.\-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i);

  // The totals block sits at the FOOT, so these read the whole text.
  const net = text.match(/net\s*amount\s*[:.\-]?\s*([\d,]+\.?\d*)/i);
  const totals = text.match(/otal\s*[:.\-]?\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i);

  return {
    supplierId,
    supplierName,
    gstin,
    invoiceNo: (invNo?.[1] ?? "").trim(),
    invoiceDate: invDate ? toISODate(invDate[1]) : "",
    netAmount: net ? net[1].replace(/,/g, "") : "",
    taxableAmount: totals ? totals[3].replace(/,/g, "") : "",
    rows: parseInvoiceText(text),
  };
}
