import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readWorkbook } from "@/lib/pharmacy/sheet-parse";

/**
 * What a distributor actually emails.
 *
 * The old reader assumed the file was the template we hand out - one sheet, the
 * column names in row 1, nothing above them. Almost nothing arrives like that.
 * A real export leads with the firm's name and its GSTIN, blanks a row, and
 * only then prints the headings; `sheet_to_json` keyed off row 1 turns that into
 * columns named `__EMPTY_3`, matches none of them, and reports "no rows found"
 * over a file whose every value was sitting right there.
 *
 * Each fixture below is a layout that used to come back empty.
 */

/** An array-of-arrays into a real .xlsx blob, the way a browser would get one. */
function book(sheets: Record<string, unknown[][]>): Blob {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([buf]);
}

const HEADINGS = ["S.No", "Product Name", "Pack", "Batch No", "Expiry", "Qty", "Free Qty", "MRP", "Rate", "Amount", "GST%", "HSN"];
const LINES: unknown[][] = [
  [1, "DULCOFLEX TAB", "15T", "DLA26026", "02/29", 10, 0, 18.59, 14.87, 148.70, 5, 300490],
  [2, "SUCRAFIL O GEL", "200ML", "P0300", "04/29", 2.5, 0.5, 295.00, 225.00, 562.50, 5, 300490],
  [3, "MUCAINE GEL", "200ML", "2620150E", "04/29", 3, 0, 275.68, 210.04, 630.12, 5, 300490],
];

describe("a spreadsheet with the firm's letterhead above the table", () => {
  const file = book({
    Sheet1: [
      ["VISHWANATH MEDICAL STORES"],
      ["GSTIN : 36AASFV8075E1ZJ"],
      ["Invoice No : RR8976", "", "", "Date : 23/07/2026"],
      [],
      HEADINGS,
      ...LINES,
      [],
      ["", "Total", "", "", "", 15.5, "", "", "", 1341.32],
    ],
  });

  it("finds the headings wherever they sit", async () => {
    const r = await readWorkbook(file);
    expect(r.headerRow).toBeGreaterThan(0);   // not row 1, which is the letterhead
    expect(r.inferred).toBe(false);           // found by name, not guessed at
    expect(r.rows).toHaveLength(3);
  });

  it("reads the invoice's own number and date off the letterhead", async () => {
    const r = await readWorkbook(file);
    expect(r.invoiceNo).toBe("RR8976");
    expect(r.invoiceDate).toBe("2026-07-23");
    expect(r.supplierName).toContain("MEDICAL STORES");
  });

  it("leaves the totals row out of the stock", async () => {
    const r = await readWorkbook(file);
    expect(r.rows.some((x) => /total/i.test(x.medicine))).toBe(false);
  });

  it("takes a bare MM/YY expiry to the END of the month", async () => {
    const r = await readWorkbook(file);
    expect(r.rows[0].expiry).toBe("2029-02-28");
  });

  it("does NOT let 'Free Qty' steal the quantity column", async () => {
    // "FreeQty" contains "qty". Testing quantity first hands it the free-goods
    // column, and 10 strips of Dulcoflex arrive as a bonus zero.
    const r = await readWorkbook(file);
    expect(r.rows[0].qty).toBe("10");
    expect(r.rows[0].free).toBe("0");
    expect(r.rows[1].qty).toBe("2.5");
    expect(r.rows[1].free).toBe("0.5");
  });
});

describe("a workbook whose line items are not on the first sheet", () => {
  it("searches every sheet rather than giving up on sheet one", async () => {
    const file = book({
      Summary: [["Account summary"], ["Outstanding", 14276]],
      "Bill Detail": [HEADINGS, ...LINES],
    });
    const r = await readWorkbook(file);
    expect(r.sheetName).toBe("Bill Detail");
    expect(r.rows).toHaveLength(3);
  });
});

describe("a spreadsheet with no column headings at all", () => {
  // Some billing systems export the grid and nothing else. There is no name to
  // match, so the columns are identified by what is IN them.
  const file = book({ Sheet1: LINES });

  it("still finds the rows", async () => {
    const r = await readWorkbook(file);
    expect(r.inferred).toBe(true);
    expect(r.rows).toHaveLength(3);
  });

  it("knows the expiry column by its MM/YY shape", async () => {
    const r = await readWorkbook(file);
    expect(r.rows[0].expiry).toBe("2029-02-28");
  });

  it("knows the batch and HSN columns by their shape", async () => {
    const r = await readWorkbook(file);
    expect(r.rows[0].batchNo).toBe("DLA26026");
    expect(r.rows[0].hsn).toBe("300490");
    expect(r.rows[0].gst).toBe("5");
  });

  it("separates quantity, rate and amount by arithmetic", async () => {
    // Four columns of bare numbers, and no name to tell them apart. Exactly one
    // triple satisfies amount = rate x qty on every row, and finding it names
    // all three at once - far safer than assuming a column order that changes
    // from one distributor to the next.
    const r = await readWorkbook(file);
    expect(r.rows[0].qty).toBe("10");
    expect(r.rows[0].rate).toBe("14.87");
    expect(r.rows[0].amount).toBe("148.7");
    expect(r.rows[0].mrp).toBe("18.59");
  });

  it("takes the wordiest column as the product name", async () => {
    const r = await readWorkbook(file);
    expect(r.rows[2].medicine).toBe("MUCAINE GEL");
  });
});

describe("a CSV in the template's own layout", () => {
  it("still imports, unchanged", async () => {
    const csv = [
      "Medicine,Pack,Batch No,Expiry,Quantity,Free,MRP,Purchase Rate,GST%,HSN,Supplier Ref",
      "Paracetamol 500mg,15T,B1234,2027-06-30,100,0,18.50,12.00,5,300490,INV-2024-001",
    ].join("\n");
    const r = await readWorkbook(new Blob([csv], { type: "text/csv" }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      medicine: "Paracetamol 500mg", pack: "15T", batchNo: "B1234",
      expiry: "2027-06-30", qty: "100", mrp: "18.5", rate: "12", hsn: "300490",
      supplier: "INV-2024-001",
    });
  });
});

describe("a file with nothing in it", () => {
  it("reports no rows rather than throwing", async () => {
    const r = await readWorkbook(book({ Sheet1: [["hello"], ["world"]] }));
    expect(r.rows).toHaveLength(0);
  });
});
