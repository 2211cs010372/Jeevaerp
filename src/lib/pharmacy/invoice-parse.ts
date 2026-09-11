/**
 * Reading a distributor's GST invoice.
 *
 * Pure parsing, deliberately outside the React component: this is the part that
 * can be wrong in ways nobody notices until a batch is booked against the wrong
 * company or a wrong expiry reaches the shelf. It is tested against the RAW OCR
 * of real Medical Stores GST invoices, noise included.
 *
 * THE LAYOUTS. Indian pharma invoices print varying column orders:
 *   Format 1: SNO · PRODUCT NAME · PACK · QTY · FREE · OMrp · BATCH · M.R.P · EXP · RATE · AMOUNT · G% · HSN
 *   Format 2: SNO · PRODUCT NAME · HSN · BATCH · EXP · QTY · FREE · RATE · AMOUNT · MRP · GST%
 *   Format 3: PRODUCT NAME · BATCH · EXP · QTY · RATE · MRP · AMOUNT
 *   Format 4: Multi-line (Line 1: Product Name, Line 2: Batch, Exp, Qty, Rate, Amount)
 *
 * Anchors degrade gracefully:
 *   tier 1  HSN          all columns, high confidence
 *   tier 2  EXPIRY       right edge lost; everything but HSN/G% still read
 *   tier 3  SMART COLUMNS (Flexible column order + Arithmetic validation: Qty * Rate ≈ Amount)
 *   tier 4  BATCH        expiry unreadable; name, qty, prices recovered
 */

export type RowConfidence = "high" | "medium" | "low";

export interface ParsedRow {
  medicine: string;
  pack: string;
  qty: string;
  free: string;
  oMrp: string;
  batchNo: string;
  mrp: string;
  expiry: string;
  rate: string;
  amount: string;
  gst: string;
  hsn: string;
  supplier: string;
  createNew?: boolean;
  confidence?: RowConfidence;
}

export interface SupplierRef { id: string; name: string }

export interface ParsedInvoice {
  supplierId: string;
  supplierName: string;
  gstin: string;
  invoiceNo: string;
  invoiceDate: string;
  netAmount: string;
  taxableAmount: string;
  rows: ParsedRow[];
}

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Whatever a supplier wrote, into YYYY-MM-DD. */
export function toISODate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return isoLocal(v);
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  let m;
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/))) {
    const d = m[1], mo = m[2], y = m[3].length === 2 ? "20" + m[3] : m[3];
    if (+mo < 1 || +mo > 12) return "";
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD-MMM-YYYY e.g. 12-JAN-2026 or 12/JUL/26
  if ((m = s.match(/^(\d{1,2})[/\-.]([A-Za-z]{3,9})[/\-.](\d{2,4})$/i))) {
    const d = m[1];
    const moName = m[2].toLowerCase();
    const mo = MONTH_NAMES[moName];
    if (!mo) return "";
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${String(mo).padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // MM/YY or MM/YYYY or MM-YY or MM.YY -> Expiry (End of month)
  if ((m = s.match(/^(\d{1,2})[/\-.](\d{2,4})$/))) {
    const mo = Number(m[1]);
    if (mo < 1 || mo > 12) return "";
    const y = Number(m[2].length === 2 ? "20" + m[2] : m[2]);
    const last = new Date(y, mo, 0).getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  // MMM-YYYY or MMM/YY e.g. JUN/27
  if ((m = s.match(/^([A-Za-z]{3,9})[/\-.](\d{2,4})$/i))) {
    const moName = m[1].toLowerCase();
    const mo = MONTH_NAMES[moName];
    if (!mo) return "";
    const y = Number(m[2].length === 2 ? "20" + m[2] : m[2]);
    const last = new Date(y, mo, 0).getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : isoLocal(d);
}

const clean = (s: string) => (s || "").replace(/[^\d.]/g, "");
const isNum = (s: string) => { const c = clean(s); return c !== "" && /^\d+(\.\d+)?$/.test(c); };

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

function asNumber(tok: string): string {
  const raw = (tok || "").replace(/[^\dA-Za-z.,]/g, "");
  if (!raw) return "";
  const digits = (raw.match(/\d/g) ?? []).length;
  if (digits === 0 || digits < raw.length / 2) return "";

  let s = digitsOnly(raw);
  s = s.replace(/,(?=\d{3}\b)/g, "");
  s = s.replace(/,/g, ".");
  s = s.replace(/[.]+$/, "");
  return /^\d+(\.\d+)?$/.test(s) ? s : "";
}

const THIS_YEAR = new Date().getFullYear();

function asExpiry(tok: string, strict = true): string {
  const raw = (tok || "").replace(/[^\dA-Za-z/\-.]/g, "");
  if (!raw) return "";

  // Check month name format first e.g. JUN/27, 06-JUN-27
  let iso = toISODate(raw);
  if (iso) {
    const yr = Number(iso.slice(0, 4));
    if (yr >= THIS_YEAR - 6 && yr <= THIS_YEAR + 20) return iso;
  }

  const fixed = digitsOnly(raw).replace(/[.\-]/g, "/");
  let mo = 0, yTxt = "";

  const m = fixed.match(/^(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    mo = Number(m[1]);
    yTxt = m[2];
  } else if (!strict) {
    const d = fixed.replace(/\D/g, "");
    if (d.length !== 4 && d.length !== 6) return "";
    mo = Number(d.slice(0, 2));
    yTxt = d.slice(2);
  } else return "";

  if (mo < 1 || mo > 12) return "";
  const year = yTxt.length === 2 ? 2000 + Number(yTxt) : Number(yTxt);
  if (year < THIS_YEAR - 6 || year > THIS_YEAR + 20) return "";
  return toISODate(`${mo}/${yTxt}`);
}

const isMonthYear = (s: string) => asExpiry(s) !== "";

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

function tokenise(raw: string): string[] | null {
  const line = raw.replace(/[|¦~^°§©®]/g, " ").replace(/\s+/g, " ").trim();
  if (line.length < 12) return null;
  if (NOISE.test(line)) return null;
  const t = line.split(" ");
  return t.length < 5 ? null : t;
}

function looksLikeBatch(tok: string): boolean {
  const s = (tok || "").replace(/[^A-Za-z0-9/-]/g, "");
  if (s.length < 2) return false;
  if (/\./.test(tok)) return false;
  if (isMonthYear(tok)) return false;
  const hasDigit = /\d/.test(s);
  const hasAlpha = /[A-Za-z]/.test(s);
  if (hasDigit && hasAlpha) return true;
  return hasDigit && !hasAlpha && s.length >= 4;
}

function scanLeft(t: string[], batchIdx: number) {
  let cursor = batchIdx;
  let oMrp = "";
  const maybeCode = (t[batchIdx - 1] ?? "").replace(/[^A-Za-z.]/g, "");
  if (maybeCode.length >= 2 && maybeCode.length <= 6) {
    oMrp = maybeCode;
    cursor = batchIdx - 1;
  }

  const pureNum = (tok: string) => /^\d+(\.\d+)?$/.test(tok.replace(/[^\d.]/g, "")) && !/[A-Za-z]/.test(tok);
  const nums: { i: number; v: string }[] = [];
  for (let j = cursor - 1; j >= 1 && nums.length < 2; j--) {
    const tok = t[j];
    if (!tok || tok.trim() === "") continue;
    if (pureNum(tok)) nums.unshift({ i: j, v: clean(tok) });
    else break;
  }
  if (nums.length === 0) return null;
  let qty = nums[0].v;
  let free = nums.length > 1 ? nums[1].v : "";
  let firstNumIdx = nums[0].i;

  const packRaw = (t[firstNumIdx - 1] ?? "").replace(/[^A-Za-z0-9`'’]/g, "");
  let pack = /^\d{1,4}[A-Za-z`'’]{0,4}$/.test(packRaw) ? packRaw.replace(/[^A-Za-z0-9]/g, "") : "";

  const looksLikePack = (v: string) => !v.includes(".") && Number(v) >= 10;
  if (!pack && nums.length > 1 && looksLikePack(nums[0].v)) {
    pack = nums[0].v;
    qty = nums[1].v;
    free = "";
    firstNumIdx = nums[1].i;
  }

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

/** TIER 1 - HSN anchor */
function byHsn(t: string[]): ParsedRow | null {
  let hi = -1;
  for (let i = t.length - 1; i >= 6; i--) {
    if (/^\d{6}$/.test(clean(t[i]))) { hi = i; break; }
  }
  if (hi < 6) return null;

  const hsn = clean(t[hi]);
  const gst = clean(t[hi - 1]);
  if (!isNum(gst) || Number(gst) > 28) return null;

  const amount = clean(t[hi - 2]);
  const rate = clean(t[hi - 3]);
  if (!isNum(amount) || !isNum(rate)) return null;

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

/** TIER 2 - Expiry anchor */
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

  const rate = asNumber(t[ei + 1] ?? "");
  const amount = asNumber(t[ei + 2] ?? "");
  const gstRaw = asNumber(t[ei + 3] ?? "");
  const gst = gstRaw && Number(gstRaw) <= 28 ? gstRaw : "";
  const hsnRaw = clean(t[ei + 4] ?? "");
  const hsn = /^\d{6}$/.test(hsnRaw) ? hsnRaw : "";

  return { ...blank(), ...left, batchNo, mrp, expiry, rate, amount, gst, hsn, confidence: "medium" };
}

/** TIER 3 - Smart Column Finder with Arithmetic Verification (Qty * Rate ≈ Amount) */
function bySmartColumns(t: string[]): ParsedRow | null {
  let expIdx = -1;
  let batchIdx = -1;
  let hsnIdx = -1;

  for (let i = 0; i < t.length; i++) {
    if (expIdx < 0 && isMonthYear(t[i])) expIdx = i;
    else if (batchIdx < 0 && looksLikeBatch(t[i])) batchIdx = i;
    else if (hsnIdx < 0 && /^\d{6}$/.test(clean(t[i]))) hsnIdx = i;
  }

  if (expIdx < 0 && batchIdx < 0) return null;

  const expiry = expIdx >= 0 ? asExpiry(t[expIdx]) : "";
  const batchNo = batchIdx >= 0 ? t[batchIdx].replace(/[^A-Za-z0-9/-]/g, "") : "";
  const hsn = hsnIdx >= 0 ? clean(t[hsnIdx]) : "";

  // Extract all numeric values
  const nums: { i: number; v: number; s: string }[] = [];
  for (let i = 0; i < t.length; i++) {
    if (i === expIdx || i === batchIdx || i === hsnIdx) continue;
    const numStr = asNumber(t[i]);
    if (numStr && !isNaN(Number(numStr))) {
      nums.push({ i, v: Number(numStr), s: numStr });
    }
  }

  if (nums.length < 3) return null;

  // Find candidate Qty, Rate, Amount using Qty * Rate ≈ Amount
  let bestQty = "", bestRate = "", bestAmount = "", bestMrp = "", bestGst = "";
  let minDiff = Infinity;

  for (let a = 0; a < nums.length; a++) {
    const q = nums[a].v;
    if (q <= 0 || q > 10000) continue;
    for (let b = 0; b < nums.length; b++) {
      if (a === b) continue;
      const r = nums[b].v;
      if (r <= 0) continue;
      for (let c = 0; c < nums.length; c++) {
        if (c === a || c === b) continue;
        const amt = nums[c].v;
        const diff = Math.abs(q * r - amt);
        const relDiff = diff / (amt || 1);
        if (relDiff < 0.05 && diff < minDiff) {
          minDiff = diff;
          bestQty = nums[a].s;
          bestRate = nums[b].s;
          bestAmount = nums[c].s;
        }
      }
    }
  }

  // Find MRP (largest remaining price > rate)
  for (const n of nums) {
    if (n.s !== bestQty && n.s !== bestRate && n.s !== bestAmount) {
      if (!bestMrp || n.v > Number(bestMrp)) {
        bestMrp = n.s;
      }
    }
  }

  // Find GST (small number <= 28)
  for (const n of nums) {
    if (n.s !== bestQty && n.s !== bestRate && n.s !== bestAmount && n.s !== bestMrp) {
      if (n.v > 0 && n.v <= 28 && [0, 5, 12, 18, 28].includes(n.v)) {
        bestGst = n.s;
        break;
      }
    }
  }

  // Medicine Name: tokens before the first numeric / batch token
  const firstDataIdx = Math.min(
    expIdx >= 0 ? expIdx : 99,
    batchIdx >= 0 ? batchIdx : 99,
    nums[0]?.i ?? 99,
  );
  if (firstDataIdx <= 0 || firstDataIdx === 99) return null;

  const medicine = t
    .slice(0, firstDataIdx)
    .join(" ")
    .replace(/^\s*\d{1,3}\s*[\-./]?\s*(?=[^\d])/, "")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[^A-Za-z0-9 .\-/%]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (medicine.length < 3) return null;

  return {
    ...blank(),
    medicine,
    batchNo,
    expiry,
    qty: bestQty,
    rate: bestRate,
    amount: bestAmount,
    mrp: bestMrp,
    gst: bestGst,
    hsn,
    confidence: "medium",
  };
}

/** TIER 4 - Batch anchor */
function byBatch(t: string[]): ParsedRow | null {
  for (let i = t.length - 2; i >= 3; i--) {
    if (!looksLikeBatch(t[i])) continue;

    const after: { s: string; n: number }[] = [];
    for (let j = i + 1; j < t.length && after.length < 6; j++) {
      const s = asNumber(t[j]);
      if (s) after.push({ s, n: Number(s) });
    }
    if (!after.length || after[0].n <= 0) continue;
    const mrp = after[0];

    const left = scanLeft(t, i);
    if (!left) continue;
    if (!/[A-Za-z]{3}/.test(left.medicine)) continue;
    const qty = Number(left.qty);
    if (!(qty > 0)) continue;

    let rate = "", amount = "";
    outer: for (let a = 1; a < after.length; a++) {
      if (after[a].n <= 0 || after[a].n > mrp.n) continue;
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

/** Multi-line row merger: pairs product name on line N with batch/qty on line N+1 */
function mergeMultiLines(rawLines: string[]): string[] {
  const merged: string[] = [];
  let currentHeader = "";

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line || line.length < 3) continue;

    // Line with medicine name only (mostly text, no numbers/prices/batch)
    const isTextHeader =
      /^[A-Z0-9\s.\-/%]{4,40}$/i.test(line) &&
      !isMonthYear(line) &&
      !NOISE.test(line) &&
      (line.match(/\d/g) ?? []).length < line.length * 0.2;

    if (isTextHeader && i + 1 < rawLines.length) {
      currentHeader = line;
    } else if (currentHeader) {
      merged.push(`${currentHeader} ${line}`);
      currentHeader = "";
    } else {
      merged.push(line);
    }
  }

  return merged;
}

export function parseInvoiceText(text: string): ParsedRow[] {
  const rawLines = text.split("\n");
  const mergedLines = mergeMultiLines(rawLines);

  const tokens = mergedLines.map(tokenise);
  const out: ParsedRow[] = [];
  const seen = new Set<string>();

  for (const t of tokens) {
    if (!t) continue;
    const row = byHsn(t) ?? byExpiry(t) ?? bySmartColumns(t);
    if (row && row.medicine) {
      const key = `${row.medicine.toLowerCase()}_${row.batchNo}_${row.qty}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(row);
      }
    }
  }

  if (out.length >= 3) return out;

  // Loose fallback pass
  const loose: ParsedRow[] = [];
  for (const t of tokens) {
    if (!t) continue;
    const row = byHsn(t) ?? byExpiry(t) ?? bySmartColumns(t) ?? byBatch(t);
    if (row && row.medicine) {
      const key = `${row.medicine.toLowerCase()}_${row.batchNo}_${row.qty}`;
      if (!seen.has(key)) {
        seen.add(key);
        loose.push(row);
      }
    }
  }

  return loose.length > out.length ? loose : out;
}

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Token set overlap score between 0 and 1 */
function tokenSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  const setB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  if (setA.size === 0 || setB.size === 0) return 0;
  let matches = 0;
  for (const t of setA) {
    if (setB.has(t)) matches++;
  }
  return (matches * 2) / (setA.size + setB.size);
}

export function parseInvoiceHeader(text: string, suppliers: SupplierRef[]): ParsedInvoice {
  const head = text.slice(0, 3000);
  const flat = squash(head);

  // Supplier matching (exact substring, first word, and token similarity)
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

  // Masthead detection
  let supplierName = "";
  for (const line of head.split("\n").slice(0, 8)) {
    const cand = line
      .replace(/TAX\s*INVOICE|GST\s*INVOICE|CASH\s*MEMO|CREDIT\s*MEMO/gi, "")
      .replace(/[^A-Za-z .&-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cand.length >= 6 && (cand.match(/[A-Z]{2,}/g) ?? []).length >= 1) {
      if (!/invoice|bill|date|gstin|phone|address|page|hsn|sl|no/i.test(cand)) {
        supplierName = cand;
        break;
      }
    }
  }

  const gstin = (head.match(/\bGSTIN(?:\/UIN)?\s*[:.\-]?\s*([0-9A-Z]{15})/i)?.[1] ?? "").toUpperCase();

  // Expanded Invoice No regexes
  const invNoMatch =
    head.match(/\b(?:bill\s*no|invoice\s*no|inv\s*no|tax\s*invoice\s*no|inv\s*#|bill\s*#|doc\s*no|vouch\s*no|b\.?\s*no)\s*[:.\-#]*\s*([A-Za-z0-9][A-Za-z0-9/\-]{1,24})/i) ||
    head.match(/\b(inv[0-9]{3,12}|bill[0-9]{3,12})/i);

  // Expanded Invoice Date regexes
  const invDateMatch =
    head.match(/\b(?:inv(?:oice)?\s*date|bill\s*date|dated?|dt)\s*[:.\-]?\s*(\d{1,2}[/\-.][A-Za-z0-9]{2,4}[/\-.]\d{2,4})/i) ||
    head.match(/\bdate\s*[:.\-]?\s*(\d{1,2}[/\-.][A-Za-z0-9]{2,4}[/\-.]\d{2,4})/i);

  // Expanded Net Amount regexes
  const netMatch =
    text.match(/(?:net\s*amount|grand\s*total|net\s*payable|total\s*amount|payable\s*amount|invoice\s*total|total\s*bill|net\s*amt)\s*[:.\-]?\s*(?:rs\.?)?\s*([\d,]+\.?\d*)/i) ||
    text.match(/\btotal\s*[:.\-]?\s*(?:rs\.?)?\s*([\d,]+\.\d{2})/i);

  const totalsMatch = text.match(/otal\s*[:.\-]?\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i);

  return {
    supplierId,
    supplierName,
    gstin,
    invoiceNo: (invNoMatch?.[1] ?? "").trim().replace(/[/\-.]+$/, ""),
    invoiceDate: invDateMatch ? toISODate(invDateMatch[1]) : "",
    netAmount: netMatch ? netMatch[1].replace(/,/g, "") : "",
    taxableAmount: totalsMatch ? totalsMatch[3].replace(/,/g, "") : "",
    rows: parseInvoiceText(text),
  };
}
