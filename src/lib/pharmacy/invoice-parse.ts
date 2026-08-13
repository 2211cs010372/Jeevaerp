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
 * Only PRODUCT NAME has a variable width, and FREE is usually blank.
 *
 * ── WHY THERE ARE THREE PARSERS AND NOT ONE ──
 *
 * The first version anchored every line on HSN, the rightmost fixed-width field:
 * a 6-digit code in a fixed position, by far the most reliable landmark on a
 * clean scan. That is still tier 1, because when it fires it reads all thirteen
 * columns correctly.
 *
 * But it is ALL-OR-NOTHING. HSN sits at the far right edge of the paper, which
 * is exactly the part a phone photo loses - to shadow, to the curl of the page,
 * to being cropped a centimetre short. Miss HSN and the line returns null; miss
 * it on every line and a 23-item invoice imports as an empty grid while the
 * header (matched by loose regex over the whole page) still fills in perfectly.
 * That is the "it only got the supplier and the date" failure, and it is a
 * parser failure, not an OCR failure - the text was there.
 *
 * So the anchors now degrade:
 *
 *   tier 1  HSN        all 13 columns, high confidence
 *   tier 2  EXPIRY     right edge lost; everything but HSN/G% still read
 *   tier 3  BATCH      expiry unreadable too; name, qty and money recovered,
 *                      expiry left BLANK for a human to key
 *
 * Tier 3 runs only when tiers 1 and 2 have found almost nothing across the whole
 * page, because it is the one that can hallucinate a row out of a totals line.
 * A blank expiry is deliberate: the grid marks it red and refuses the import
 * until a person types it off the strip. Saving them the product name, the batch
 * and the prices while insisting on the one field that expires stock is the
 * whole trade.
 */

/** How the row was read - drives the "check this one" flag in the grid. */
export type RowConfidence = "high" | "medium" | "low";

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
  /** Which anchor found this row. Absent on hand-keyed and spreadsheet rows. */
  confidence?: RowConfidence;
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

/**
 * The letters tesseract hands back when it meant digits.
 *
 * Applied ONLY where the column is numeric by definition - a quantity, an MRP,
 * an expiry. Never to a batch number: "SIHO887A" is a real batch and rewriting
 * its S and O into 5 and 0 would invent a consignment that does not exist.
 */
const OCR_DIGITS: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  l: "1", I: "1", i: "1", "|": "1", "!": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  b: "6", G: "6",
  T: "7", "?": "7",
  B: "8",
  g: "9", q: "9",
};
const digitsOnly = (s: string) => s.replace(/[A-Za-z|!?]/g, (c) => OCR_DIGITS[c] ?? "");

/**
 * A numeric cell, with the OCR alphabet folded back into digits.
 *
 * Guarded by shape: the token has to be mostly digits already. Without that
 * guard a product name like "TAB" folds into "748" and becomes a price.
 */
function asNumber(tok: string): string {
  const raw = (tok || "").replace(/[^\dA-Za-z.,]/g, "");
  if (!raw) return "";
  const digits = (raw.match(/\d/g) ?? []).length;
  if (digits === 0 || digits < raw.length / 2) return "";

  // The separators, in the order that stops them destroying each other.
  // "1,371.40" is one thousand three hundred; "148.70," is a price with the
  // table's comma still stuck to it. Reading the comma as a decimal point in
  // either case turns a rate of 148.70 into nothing at all, and a blank rate on
  // a goods receipt is a purchase booked at zero cost.
  let s = digitsOnly(raw);
  s = s.replace(/,(?=\d{3}\b)/g, "");     // thousands separator
  s = s.replace(/,/g, ".");               // European decimal comma
  s = s.replace(/[.]+$/, "");             // trailing punctuation off the table
  return /^\d+(\.\d+)?$/.test(s) ? s : "";
}

const THIS_YEAR = new Date().getFullYear();

/**
 * An MM/YY expiry, with the separator and the digits repaired.
 *
 * `strict` is the difference between scanning for the anchor and reading a cell
 * whose position is already known. When SEARCHING we insist on a real separator
 * and a plausible year, because a bare four digits is also a batch number, an
 * amount, and half the serial numbers on the page. Once the column is pinned by
 * a stronger anchor we accept "0128" printed without the slash.
 */
function asExpiry(tok: string, strict = true): string {
  const raw = (tok || "").replace(/[^\dA-Za-z/\-.]/g, "");
  if (!raw) return "";
  const fixed = digitsOnly(raw).replace(/[.\-]/g, "/");
  let mo = 0, yTxt = "";

  const m = fixed.match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    mo = Number(m[1]);
    yTxt = m[2];
  } else if (!strict) {
    // "0128" / "062028" - the slash didn't survive the scan.
    const d = fixed.replace(/\D/g, "");
    if (d.length !== 4 && d.length !== 6) return "";
    mo = Number(d.slice(0, 2));
    yTxt = d.slice(2);
  } else return "";

  if (mo < 1 || mo > 12) return "";
  const year = yTxt.length === 2 ? 2000 + Number(yTxt) : Number(yTxt);
  // Stock on an invoice expires soon-ish. This bound is what stops a product
  // name like "AZORAN 10/325" from being mistaken for an October 325 expiry.
  if (year < THIS_YEAR - 6 || year > THIS_YEAR + 20) return "";
  return toISODate(`${mo}/${yTxt}`);
}

const isMonthYear = (s: string) => asExpiry(s) !== "";

/**
 * Lines that are furniture, not stock.
 *
 * Tier 3 is loose enough to read a row out of the totals block if left to it, so
 * the bank line, the tax summary and the masthead are struck out by name before
 * any parser sees them. Nothing here appears in a medicine's name.
 */
const NOISE = new RegExp(
  [
    "\\bbank\\b", "\\bifsc\\b", "a/c\\s*no", "\\bbranch\\s*:", "\\bcheque\\b",
    "net\\s*amount", "netamount", "gross\\s*amt", "grossamt", "\\btaxable\\b",
    "\\bdisc\\s*amt\\b", "\\bdiscamt\\b", "\\bcgst\\b", "\\bsgst\\b", "\\bigst\\b",
    "\\btotal\\b", "\\botal\\b", "\\bgst\\s*%", "\\bgstin\\b", "\\bpan\\b\\s*:",
    "jurisdiction", "\\brupees\\b", "goods\\s*once", "terms\\s*(&|and)",
    "\\bd\\.?l\\.?\\s*no", "\\bdlno", "food\\s*lic", "\\be-?mail\\b",
    "\\bphone\\b", "\\bmobile\\b", "\\bpage\\s*:", "\\bsub\\s*total\\b",
    "\\bitems?\\s*:", "\\btems\\s*:", "\\btot\\.?\\s*qty", "\\botqty\\b",
    "\\bmade?\\s*by\\b", "\\bprint\\s*@", "\\bsignature\\b", "\\bfor\\s+m/s\\b",
    "\\bround\\s*off\\b", "\\br\\.?off\\b", "\\bfreight\\b", "\\bdebit\\s*note\\b",
    "\\bcredit\\s*note\\b", "\\bhave\\s+a\\s+nice",
  ].join("|"),
  "i",
);

/** The tokens of one line, with table borders removed. Null when it isn't one. */
function tokenise(raw: string): string[] | null {
  const line = raw.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim();
  if (line.length < 15) return null;
  if (NOISE.test(line)) return null;
  const t = line.split(" ");
  return t.length < 8 ? null : t;
}

/** A batch number: letters and digits mixed, or a long run of bare digits. */
function looksLikeBatch(tok: string): boolean {
  const s = (tok || "").replace(/[^A-Za-z0-9/-]/g, "");
  if (s.length < 3) return false;
  if (/\./.test(tok)) return false;                     // a price, not a batch
  const hasDigit = /\d/.test(s);
  const hasAlpha = /[A-Za-z]/.test(s);
  if (hasDigit && hasAlpha) return true;
  return hasDigit && !hasAlpha && s.length >= 5;        // "48020919", "51389"
}

/**
 * PRODUCT NAME · PACK · QTY · FREE · OMrp - everything left of the batch.
 *
 * Shared by every tier, because the left half of the line is the half that
 * survives: it is the widest, the darkest, and nowhere near the edge of the
 * paper. Only the anchor on the right differs between tiers.
 */
function scanLeft(t: string[], batchIdx: number) {
  // OMrp is a short alphabetic company code (ARIS, AVEN, U.S., GLEN, PFIZ).
  let cursor = batchIdx;
  let oMrp = "";
  const maybeCode = (t[batchIdx - 1] ?? "").replace(/[^A-Za-z.]/g, "");
  if (maybeCode.length >= 2 && maybeCode.length <= 6) {
    oMrp = maybeCode;
    cursor = batchIdx - 1;
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
  //
  // The SNO is stripped from the TEXT, not by dropping the first token. There is
  // no gutter between the serial number and the name on these invoices, so OCR
  // routinely glues them: "12/CREMAFFIN PINK SYP", "1'SMUTH SUS". Dropping the
  // token threw the first WORD of the product away with the serial - CREMAFFIN
  // PINK arrived in the grid as "PINK SYP", matching nothing in the catalog.
  const nameEnd = pack ? firstNumIdx - 1 : firstNumIdx;
  const medicine = t.slice(0, nameEnd)
    .join(" ")
    .replace(/^\s*\d{1,3}\s*(?=[^\d])/, "")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[^A-Za-z0-9 .\-/%]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (medicine.length < 3) return null;

  return { medicine, pack, qty, free, oMrp };
}

const blank = (): ParsedRow => ({
  medicine: "", pack: "", qty: "", free: "", oMrp: "", batchNo: "",
  mrp: "", expiry: "", rate: "", amount: "", gst: "", hsn: "", supplier: "",
});

/**
 * TIER 1 - anchored on HSN.
 *
 * The rightmost fixed-width field and the strongest landmark there is: a 6-digit
 * code in a fixed position. Anchoring on the MM/YY expiry instead breaks the
 * moment a product name contains a number, and these are full of them:
 * "ISTAMET 50/500", "TELMA CT40/6.25MG", "ECOSPRIN AV 75/20". When this fires
 * every one of the thirteen columns is placed, so it is tried first and its
 * result is never second-guessed.
 */
function byHsn(t: string[]): ParsedRow | null {
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

  // EXP sits just left of RATE. Position is pinned, so a missing slash is fine.
  const expiry = asExpiry(t[hi - 4] ?? "", false);
  if (!expiry) return null;

  const mrp = asNumber(t[hi - 5] ?? "");
  if (!mrp) return null;

  const batchNo = (t[hi - 6] || "").replace(/[^A-Za-z0-9/-]/g, "");
  if (batchNo.length < 3) return null;

  const left = scanLeft(t, hi - 6);
  if (!left) return null;

  return { ...blank(), ...left, batchNo, mrp, expiry, rate, amount, gst, hsn, confidence: "high" };
}

/**
 * TIER 2 - anchored on the expiry.
 *
 * For the invoice photographed a centimetre short, where HSN and G% ran off the
 * edge. Everything left of RATE is still on the paper and still correct; only
 * the two label columns are gone, and those are labels - the receipt schema
 * drops an out-of-range G% rather than refusing real stock.
 *
 * Scans RIGHT TO LEFT so a product name's "10/325" can never win the anchor: the
 * name is always left of the expiry column, so the rightmost plausible MM/YY is
 * the real one. `asExpiry` in strict mode does the rest, rejecting any year that
 * isn't within a few years of today.
 */
function byExpiry(t: string[]): ParsedRow | null {
  let ei = -1;
  for (let i = t.length - 1; i >= 3; i--) {
    if (isMonthYear(t[i])) { ei = i; break; }
  }
  if (ei < 3) return null;

  const expiry = asExpiry(t[ei]);
  const mrp = asNumber(t[ei - 1] ?? "");
  if (!mrp) return null;

  const batchNo = (t[ei - 2] || "").replace(/[^A-Za-z0-9/-]/g, "");
  if (!looksLikeBatch(batchNo)) return null;

  const left = scanLeft(t, ei - 2);
  if (!left) return null;

  // Right of the anchor: RATE AMOUNT G% HSN, each present only if the paper was.
  const rate = asNumber(t[ei + 1] ?? "");
  const amount = asNumber(t[ei + 2] ?? "");
  const gstRaw = asNumber(t[ei + 3] ?? "");
  const gst = gstRaw && Number(gstRaw) <= 28 ? gstRaw : "";
  const hsnRaw = clean(t[ei + 4] ?? "");
  const hsn = /^\d{6}$/.test(hsnRaw) ? hsnRaw : "";

  return { ...blank(), ...left, batchNo, mrp, expiry, rate, amount, gst, hsn, confidence: "medium" };
}

/**
 * TIER 3 - anchored on the batch number, expiry left blank.
 *
 * The last resort, for a scan where the expiry column is a smudge. It recovers
 * the product name, the pack, the quantity and the money, and deliberately
 * returns an EMPTY expiry: the grid paints that cell red and blocks the import
 * until someone reads the date off the strip in their hand.
 *
 * Loose enough to be dangerous on its own, which is why `parseInvoiceText` only
 * reaches for it when the stronger anchors have found almost nothing on the
 * whole page. Two non-zero prices and a real product name are required, so the
 * tax-summary block - all zeroes and no name - cannot become a row.
 */
function byBatch(t: string[]): ParsedRow | null {
  for (let i = t.length - 2; i >= 3; i--) {
    if (!looksLikeBatch(t[i])) continue;

    // Everything numeric to the right. The first is the MRP - that column never
    // moves. The rest are RATE, AMOUNT, G%, HSN and, sitting among them, the
    // unreadable expiry, which OCR hands back as a plain four-digit number.
    //
    // Kept as the PRINTED string as well as the number: a price re-rendered
    // from a float loses its trailing zero, and "295" beside "295.00" on the
    // paper is one more thing for the pharmacist checking the row to doubt.
    const after: { s: string; n: number }[] = [];
    for (let j = i + 1; j < t.length && after.length < 6; j++) {
      const s = asNumber(t[j]);
      if (s) after.push({ s, n: Number(s) });
    }
    if (!after.length || after[0].n <= 0) continue;
    const mrp = after[0];

    const left = scanLeft(t, i);
    if (!left) continue;
    // A real product name, not a stray label off the totals block.
    if (!/[A-Za-z]{3}/.test(left.medicine)) continue;
    const qty = Number(left.qty);
    if (!(qty > 0)) continue;

    // RATE and AMOUNT, found by the arithmetic that ties them together:
    // amount = rate x qty, on every line of every invoice. Guessing positionally
    // instead puts the smudged expiry - "03/28" read as the number 328 - into
    // the purchase rate, and a wrong rate is invisible: stock arrives, the
    // margin report quietly lies, and nobody sees it for a quarter. Anything
    // that doesn't reconcile is left BLANK.
    let rate = "", amount = "";
    outer: for (let a = 1; a < after.length; a++) {
      if (after[a].n <= 0 || after[a].n > mrp.n) continue;   // rate never exceeds MRP
      for (let b = a + 1; b < after.length; b++) {
        if (Math.abs(after[a].n * qty - after[b].n) <= Math.max(0.05, after[b].n * 0.02)) {
          rate = after[a].s;
          amount = after[b].s;
          break outer;
        }
      }
    }

    return {
      ...blank(), ...left,
      batchNo: t[i].replace(/[^A-Za-z0-9/-]/g, ""),
      mrp: mrp.s, rate, amount,
      expiry: "",
      confidence: "low",
    };
  }
  return null;
}

/**
 * Every item row on the invoice.
 *
 * Two passes. The first uses the anchors that place columns exactly; the second
 * only happens when that found next to nothing, which means the right-hand side
 * of the page is unreadable rather than that the page has no stock on it.
 */
export function parseInvoiceText(text: string): ParsedRow[] {
  const lines = text.split("\n");
  const tokens = lines.map(tokenise);

  const out: ParsedRow[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const row = byHsn(t) ?? byExpiry(t);
    if (row) out.push(row);
  }
  if (out.length >= 3) return out;

  // Nothing worth having. Fall back to the loose anchor rather than hand the
  // pharmacist an empty grid and a scan they now have to key in by hand.
  const loose: ParsedRow[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const row = byHsn(t) ?? byExpiry(t) ?? byBatch(t);
    if (row) loose.push(row);
  }
  return loose.length > out.length ? loose : out;
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
