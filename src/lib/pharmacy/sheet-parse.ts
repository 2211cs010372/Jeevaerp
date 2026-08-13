/**
 * Reading an invoice that arrived as a spreadsheet.
 *
 * The old version assumed the file was the template we hand out: one sheet, the
 * column names in row 1, nothing above them. Almost nothing a distributor
 * actually emails looks like that. A real export has the firm's name across the
 * top, the GSTIN and the bill number underneath, a blank row, THEN the column
 * headings - and `sheet_to_json` keyed off row 1 turns all of that into columns
 * called `__EMPTY_3`, matches none of them, and reports "no rows found" over a
 * file whose every value was sitting right there.
 *
 * So nothing is assumed about where the table starts:
 *
 *   1. EVERY SHEET is read, not just the first. Distributor workbooks routinely
 *      lead with a summary tab and put the line items on sheet two.
 *   2. THE HEADER ROW IS SEARCHED FOR, down the first thirty rows, by scoring
 *      each one on how many recognisable column names it holds.
 *   3. WITH NO HEADER AT ALL the columns are identified BY THEIR CONTENT - the
 *      column of MM/YY values is the expiry, the column of six-digit integers
 *      is the HSN, and the three numeric columns that satisfy
 *      amount = rate x qty are exactly those three.
 *   4. THE ROWS ABOVE the table are not thrown away - that is where the invoice
 *      number, its date and the distributor's name are.
 *
 * Everything still lands in the same editable grid as OCR does. A spreadsheet
 * is more trustworthy than a photograph, but "more trustworthy" is not "checked".
 */

import { toISODate, type ParsedRow } from "./invoice-parse";

/** A workbook, read. */
export interface SheetExtract {
  rows: ParsedRow[];
  /** Which sheet the line items were found on. */
  sheetName: string;
  /** 0-based index of the header row, or -1 when the columns were inferred. */
  headerRow: number;
  /** True when no header was found and columns were identified by their values. */
  inferred: boolean;
  invoiceNo: string;
  invoiceDate: string;
  /** As printed above the table. Matched against suppliers on file by the caller. */
  supplierName: string;
}

type Field = keyof Pick<ParsedRow,
  "medicine" | "pack" | "qty" | "free" | "oMrp" | "batchNo" |
  "mrp" | "expiry" | "rate" | "amount" | "gst" | "hsn" | "supplier">;

/**
 * Column names, most specific first.
 *
 * The order is load-bearing. "FreeQty" contains "qty", so if quantity were
 * tested first it would claim the free-goods column and the real quantity would
 * end up unmapped - stock received as a handful of bonus strips. Each column is
 * assigned to at most one field, and each field keeps its first column.
 */
const HEADERS: [Field, RegExp][] = [
  ["free", /^(free|freeqty|freeqnty|freeqn|scheme|schqty|sch|bonus|offer)/],
  ["batchNo", /^(batch|lot)|batchno$|lotno$/],
  ["expiry", /^exp|expiry|expdt|expdate|bestbefore|useby/],
  ["hsn", /^(hsn|hsncode|sac|saccode)/],
  ["gst", /^(gst|gstrate|gstpct|gstper|tax|taxrate|vat|igst|cgst)|^g$/],
  ["mrp", /^(mrp|retailprice|saleprice|mrprs|printedmrp)/],
  ["rate", /^(purchaserate|purchase|rate|cost|buyingprice|ptr|pts|netrate|unitprice|unitcost|price)/],
  ["amount", /^(amount|amt|value|total|netamt|taxable|lineamount)/],
  ["pack", /^(pack|packing|packsize|packsz|unitpack)/],
  ["oMrp", /^(omrp|company|comp|mfr|manufacturer|mfg|make|marketedby)/],
  ["qty", /(quantity|qty|qnty|units|count|stock|nos|pcs|strips)/],
  ["medicine", /^(medicine|item|product|drug|brand|name|particular|description|goods)/],
  ["supplier", /(supplierref|invoiceno|vendor|billno|ref)/],
];

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const txt = (v: unknown) => (v instanceof Date ? toISODate(v) : String(v ?? "")).trim();
const num = (v: unknown) => txt(v).replace(/[^\d.]/g, "");

/** Which field, if any, this header cell names. */
function matchHeader(cell: unknown, taken: Set<Field>): Field | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [field, re] of HEADERS) {
    if (taken.has(field)) continue;
    if (re.test(n)) return field;
  }
  return null;
}

/** How much this row looks like a set of column headings. */
function headerScore(row: unknown[]): { score: number; map: Map<number, Field> } {
  const taken = new Set<Field>();
  const map = new Map<number, Field>();
  for (let c = 0; c < row.length; c++) {
    const f = matchHeader(row[c], taken);
    if (f) { taken.add(f); map.set(c, f); }
  }
  // A header row without a product name and a quantity is a coincidence, not a
  // table: "Total" and "Amount" appear in the summary block too.
  const essential = (taken.has("medicine") ? 1 : 0) + (taken.has("qty") ? 1 : 0) + (taken.has("batchNo") ? 1 : 0);
  return { score: essential === 0 ? 0 : taken.size + essential * 2, map };
}

const isMonthYearish = (s: string) => /^\d{1,2}\s*[/\-.]\s*\d{2,4}$/.test(s.trim()) || /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

/**
 * Columns identified by what is IN them, for a sheet with no headings at all.
 *
 * Shape first, for the columns that have an unmistakable one: an expiry column
 * is full of MM/YY, an HSN column is full of six-digit integers, a product
 * column is full of long strings of letters.
 *
 * Then arithmetic, for the numeric columns that shape cannot separate - a
 * quantity, a rate, an MRP and a line total are all just numbers. But exactly
 * one triple among them satisfies amount = rate x qty on every row, and finding
 * that triple names all three at once. It is the same reconciliation a person
 * does reading down the page, and it is far safer than assuming a column order
 * that varies by distributor.
 */
function inferColumns(rows: unknown[][]): Map<number, Field> {
  const map = new Map<number, Field>();
  const taken = new Set<Field>();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const claim = (c: number, f: Field) => { if (!taken.has(f) && !map.has(c)) { map.set(c, f); taken.add(f); } };

  const col = (c: number) => rows.map((r) => txt(r[c])).filter((v) => v !== "");
  const frac = (vals: string[], p: (s: string) => boolean) =>
    vals.length ? vals.filter(p).length / vals.length : 0;

  // ---- shape ----
  let bestName = { c: -1, len: 0 };
  for (let c = 0; c < width; c++) {
    const vals = col(c);
    if (vals.length < 2) continue;

    if (frac(vals, isMonthYearish) >= 0.6) { claim(c, "expiry"); continue; }
    if (frac(vals, (s) => /^\d{6}$/.test(s.replace(/\D/g, "")) && s.replace(/\D/g, "") === s.trim()) >= 0.6) { claim(c, "hsn"); continue; }
    if (frac(vals, (s) => /^\d{1,2}(\.\d+)?%?$/.test(s.trim()) && [0, 5, 12, 18, 28].includes(Math.round(parseFloat(s)))) >= 0.7) { claim(c, "gst"); continue; }
    if (frac(vals, (s) => /^\d{1,4}\s*(t|tab|c|cap|ml|gm|g|s|'s|`s)$/i.test(s.trim())) >= 0.6) { claim(c, "pack"); continue; }
    if (frac(vals, (s) => /[A-Za-z]/.test(s) && /\d/.test(s) && s.trim().length >= 4 && s.trim().length <= 16 && !s.includes(" ")) >= 0.6) { claim(c, "batchNo"); continue; }

    // The product name is the wordiest column on the sheet.
    if (frac(vals, (s) => /[A-Za-z]{3}/.test(s)) >= 0.7) {
      const avg = vals.reduce((a, s) => a + s.length, 0) / vals.length;
      if (avg > bestName.len) bestName = { c, len: avg };
    }
  }
  if (bestName.c >= 0) claim(bestName.c, "medicine");

  // ---- arithmetic: the qty / rate / amount triple ----
  const numeric: number[] = [];
  for (let c = 0; c < width; c++) {
    if (map.has(c)) continue;
    const vals = col(c);
    if (vals.length >= 2 && frac(vals, (s) => /^\d+(\.\d+)?$/.test(num(s)) && num(s) !== "") >= 0.8) numeric.push(c);
  }
  const valOf = (r: unknown[], c: number) => Number(num(r[c]));

  let best: { q: number; r: number; a: number; hits: number } | null = null;
  for (const q of numeric) for (const r of numeric) for (const a of numeric) {
    if (q === r || r === a || q === a) continue;
    let hits = 0, seen = 0;
    for (const row of rows) {
      const qv = valOf(row, q), rv = valOf(row, r), av = valOf(row, a);
      if (!(qv > 0) || !(rv > 0) || !(av > 0)) continue;
      seen++;
      if (Math.abs(qv * rv - av) <= Math.max(0.05, av * 0.02)) hits++;
    }
    if (seen >= 2 && hits >= seen * 0.7 && (!best || hits > best.hits)) best = { q, r, a, hits };
  }
  if (best) {
    claim(best.q, "qty");
    claim(best.r, "rate");
    claim(best.a, "amount");
  }

  // MRP is what is left over, and it is never below the purchase rate.
  const rateCol = [...map.entries()].find(([, f]) => f === "rate")?.[0];
  for (const c of numeric) {
    if (map.has(c) || taken.has("mrp")) continue;
    if (rateCol === undefined) { claim(c, "mrp"); continue; }
    const above = rows.filter((r) => valOf(r, c) > 0 && valOf(r, rateCol) > 0)
      .filter((r) => valOf(r, c) >= valOf(r, rateCol)).length;
    const both = rows.filter((r) => valOf(r, c) > 0 && valOf(r, rateCol) > 0).length;
    if (both >= 2 && above >= both * 0.8) claim(c, "mrp");
  }
  // Still nothing, and quantity never found: take the remaining columns in the
  // order the invoice prints them rather than leaving the grid empty.
  if (!taken.has("qty")) { const c = numeric.find((x) => !map.has(x)); if (c !== undefined) claim(c, "qty"); }
  if (!taken.has("mrp")) { const c = numeric.find((x) => !map.has(x)); if (c !== undefined) claim(c, "mrp"); }

  return map;
}

/** A mapped row, in the grid's shape. */
function toRow(cells: unknown[], map: Map<number, Field>): ParsedRow {
  const r: ParsedRow = {
    medicine: "", pack: "", qty: "", free: "", oMrp: "", batchNo: "",
    mrp: "", expiry: "", rate: "", amount: "", gst: "", hsn: "", supplier: "",
  };
  for (const [c, f] of map) {
    const raw = cells[c];
    if (raw === undefined || raw === null || raw === "") continue;
    switch (f) {
      case "expiry": r.expiry = toISODate(raw); break;
      case "qty": case "free": case "mrp": case "rate": case "amount": case "gst":
        r[f] = num(raw); break;
      case "hsn": r.hsn = txt(raw).replace(/\D/g, ""); break;
      default: r[f] = txt(raw); break;
    }
  }
  return r;
}

/** A row that carries no stock - a blank, a subtotal, a note. */
const isDataRow = (r: ParsedRow) =>
  (r.medicine.trim().length > 1 || r.batchNo.trim().length > 1) &&
  !/^(total|sub\s*total|grand\s*total|net|taxable|cgst|sgst|igst|round)/i.test(r.medicine.trim());

/** Invoice number, date and distributor, off the rows above the table. */
function readPreamble(rows: unknown[][], upto: number) {
  const blob = rows.slice(0, Math.max(0, upto)).map((r) => r.map(txt).join(" ")).join("\n");
  const invNo = blob.match(/\b(?:bill\s*no|invoice\s*no|inv\s*no|invoice\s*#)\s*[:.\-#]*\s*([A-Za-z0-9][A-Za-z0-9/\-]{2,24})/i);
  const invDate = blob.match(/\b(?:date|dated|bill\s*date|invoice\s*date)\s*[:.\-]?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  let supplierName = "";
  for (const line of blob.split("\n")) {
    const cand = line.replace(/GST\s*INVOICE/i, "").replace(/[^A-Za-z .&-]/g, " ").replace(/\s+/g, " ").trim();
    if (cand.length >= 8 && (cand.match(/[A-Z]{2,}/g) ?? []).length >= 2) { supplierName = cand; break; }
  }
  return {
    invoiceNo: (invNo?.[1] ?? "").trim(),
    invoiceDate: invDate ? toISODate(invDate[1]) : "",
    supplierName,
  };
}

/**
 * The line items of a workbook, from whichever sheet actually holds them.
 *
 * Each sheet is parsed independently and the one yielding the most usable rows
 * wins - cheaper and far more reliable than guessing from sheet names, which
 * are as often "Sheet1" as anything descriptive.
 */
export async function readWorkbook(file: File | Blob): Promise<SheetExtract> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });

  let best: SheetExtract = {
    rows: [], sheetName: "", headerRow: -1, inferred: false,
    invoiceNo: "", invoiceDate: "", supplierName: "",
  };

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    // header:1 gives raw rows, which is the only way to look ABOVE the headings.
    // raw:true keeps date cells as real Date objects (toISODate handles them)
    // instead of letting the sheet reformat ISO dates into ambiguous m/d/yy text.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true, blankrows: false });
    if (!grid.length) continue;

    // Score the first thirty rows; the table rarely starts lower than that.
    let hdr = -1, hdrMap = new Map<number, Field>(), bestScore = 0;
    for (let i = 0; i < Math.min(30, grid.length); i++) {
      const { score, map } = headerScore(grid[i] ?? []);
      if (score > bestScore) { bestScore = score; hdr = i; hdrMap = map; }
    }

    const body = hdr >= 0 ? grid.slice(hdr + 1) : grid;
    const map = hdr >= 0 ? hdrMap : inferColumns(body);
    if (!map.size) continue;

    // A sheet with no headings has to EARN the guess. Inference will happily
    // call the wordiest column of any two-column scratch sheet the product name
    // and hand back rows of nonsense - and rows of nonsense in the grid are far
    // worse than "couldn't read this", because they look like a successful
    // import until someone reads them. A stock line needs a name and at least
    // two of the columns that make it stock.
    if (hdr < 0) {
      const fields = new Set(map.values());
      const supporting = (["qty", "mrp", "rate", "batchNo", "expiry"] as Field[])
        .filter((f) => fields.has(f)).length;
      if (!fields.has("medicine") || supporting < 2) continue;
    }

    const rows = body.map((cells) => toRow(cells ?? [], map)).filter(isDataRow);
    if (rows.length > best.rows.length) {
      best = {
        rows,
        sheetName: name,
        headerRow: hdr,
        inferred: hdr < 0,
        ...readPreamble(grid, hdr >= 0 ? hdr : 0),
      };
    }
  }

  return best;
}

/** A spreadsheet, by type or by extension. */
export const isSheet = (f: File | Blob & { name?: string }) => {
  const name = (f as File).name ?? "";
  return /\.(xlsx|xlsm|xlsb|xls|csv|tsv|ods)$/i.test(name) ||
    /spreadsheet|excel|ms-excel|csv/i.test(f.type);
};
