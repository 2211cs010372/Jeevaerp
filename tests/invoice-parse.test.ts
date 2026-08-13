import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseInvoiceHeader, parseInvoiceText, toISODate } from "@/lib/pharmacy/invoice-parse";

/**
 * Tested against the RAW tesseract output of a real Vishwanath Medical Stores
 * GST invoice - misreads and table-border noise included. Hand-written sample
 * text would prove nothing: every bug this parser has had came from what OCR
 * actually produces, not from what an invoice looks like.
 *
 * A misread here is not cosmetic. The wrong supplier books a consignment
 * against the wrong distributor; a wrong expiry puts a real date into FEFO
 * behind a false label; a pack read as a quantity receives 158 units of a
 * 15-tablet strip.
 */

const fixture = (n: string) =>
  readFileSync(join(process.cwd(), "tests/fixtures", n), "utf8");

const P1 = fixture("invoice-vishwanath-p1.ocr.txt");
const P2 = fixture("invoice-vishwanath-p2.ocr.txt");
const SUPPLIERS = [
  { id: "vms", name: "Vishwanath Medical Stores" },
  { id: "dec", name: "Deccan Medico Agencies" },
];

describe("expiry dates", () => {
  it("takes a bare MM/YY to the END of that month", () => {
    // A strip marked 06/27 is good through 30 June. The 1st would pull stock
    // off the shelf up to a month early.
    expect(toISODate("06/27")).toBe("2027-06-30");
    expect(toISODate("02/28")).toBe("2028-02-29");   // leap year
  });

  it("reads DD/MM/YYYY, how Indian invoices are dated", () => {
    expect(toISODate("23/07/2026")).toBe("2026-07-23");
  });

  it("refuses a month that isn't a month", () => {
    expect(toISODate("13/27")).toBe("");
    expect(toISODate("n/a")).toBe("");
  });
});

describe("the invoice header", () => {
  const h = parseInvoiceHeader(P1, SUPPLIERS);

  it("matches the distributor already on file", () => {
    expect(h.supplierId).toBe("vms");
  });

  it("reads the GSTIN", () => {
    expect(h.gstin).toBe("36AASFV8075E1ZJ");
  });

  it("reads the invoice date", () => {
    expect(h.invoiceDate).toBe("2026-07-23");
  });

  it("reads the net amount actually payable", () => {
    expect(h.netAmount).toBe("14276.00");
  });

  it("reads the taxable value before GST", () => {
    expect(h.taxableAmount).toBe("13595.78");
  });

  it("keeps the printed name so an unmatched invoice can still say who sent it", () => {
    expect(h.supplierName).toContain("MEDICAL STORES");
  });

  it("never invents a distributor that isn't on file", () => {
    // Page 2 is cropped and OCRs the masthead as "i ANATH MEDICAL STORES".
    // Leaving supplierId blank is correct: a fuzzy match here would mint a
    // second Vishwanath and split the ledger.
    const h2 = parseInvoiceHeader(P2, []);
    expect(h2.supplierId).toBe("");
  });

  it("still reads the money off the second invoice", () => {
    const h2 = parseInvoiceHeader(P2, SUPPLIERS);
    expect(h2.netAmount).toBe("7959.00");
    expect(h2.invoiceNo).toBe("RR8976");
  });
});

describe("line items", () => {
  const rows = parseInvoiceText(P1);

  it("finds the bulk of a 23-line invoice", () => {
    // Not all 23: OCR merges the odd line beyond recovery. The pharmacist adds
    // those by hand, which is why every row lands in an editable grid.
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it("reads every column of a clean line", () => {
    const r = rows.find((x) => x.medicine.includes("DULCOFLEX TAB"))!;
    expect(r).toBeDefined();
    expect(r.pack).toBe("15T");
    expect(r.qty).toBe("10");
    expect(r.oMrp).toBe("AVEN");
    expect(r.batchNo).toBe("DLA26026");
    expect(r.mrp).toBe("18.59");
    expect(r.expiry).toBe("2029-02-28");
    expect(r.rate).toBe("14.87");
    expect(r.gst).toBe("5");
    expect(r.hsn).toBe("300490");
  });

  it("does NOT take the pack as the quantity", () => {
    // The bug this guards: clean("15T") is "15", so the pack passed a numeric
    // test, became the qty, and the real qty slid into FREE. A 15-tablet strip
    // was received as 15 units of stock.
    const r = rows.find((x) => x.medicine.includes("ISTAMET"))!;
    expect(r.qty).toBe("5");        // the invoice says 5, pack 15S
    expect(r.free).toBe("");
  });

  it("keeps genuine free goods", () => {
    // SUCRAFIL is the one line with real free stock: qty 2.5, free 0.5.
    const r = rows.find((x) => x.medicine.includes("SUCRAFIL"))!;
    expect(r.pack).toBe("200ML");
    expect(r.qty).toBe("2.5");
    expect(r.free).toBe("0.5");
  });

  it("survives a product name full of numbers", () => {
    // "ISTAMET 50/500" and "TELMA CT40/6.25MG" broke the old expiry-anchored
    // parser, which read the neighbours of the first MM/YY-looking token.
    expect(rows.some((r) => r.medicine.includes("50/500"))).toBe(true);
  });

  it("reads quantities off the second invoice too", () => {
    const r2 = parseInvoiceText(P2);
    expect(r2.length).toBeGreaterThanOrEqual(12);
    const telma = r2.find((x) => x.medicine.includes("TELMA H"))!;
    expect(telma.qty).toBe("3");
    expect(telma.oMrp).toBe("GLEN");
  });

  it("ignores everything that isn't an item row", () => {
    const noise = [
      "VISHWANATH MEDICAL STORES GST INVOICE",
      "Bank :UNION BANK OF INDIA A/c No:063015010000004 IFSC:UBINO806307",
      "otal: 13595.78 0.00 13595.78 | 339.87) 339.87 | NetAmount 14276.00 ]",
      "HAVE a NICE DAY | | | | | |",
      "| | | | | | | =",
    ].join("\n");
    expect(parseInvoiceText(noise)).toHaveLength(0);
  });
});

describe("a goods receipt must not be rejected over a cosmetic column", () => {
  // These arrive from OCR. The strict fields (batch, expiry, qty, price) are the
  // ones that hurt someone if wrong; PACK, OMrp, HSN and G% are labels. A
  // misread G% of "300490" - the HSN, one column over - used to 400 the whole
  // delivery, refusing to put real stock on a real shelf.
  it("drops an out-of-range GST rather than failing the receipt", async () => {
    const { receiveGoodsSchema } = await import("@/server/validators/procurement");
    const r = receiveGoodsSchema.safeParse({
      supplierId: "s1",
      items: [{
        medicineId: "m1", batchNo: "B1", expiryDate: "2029-02-28",
        qty: 10, unitCost: 14.87, mrp: 18.59, gstRatePct: 300490,
      }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0].gstRatePct).toBeUndefined();
  });

  it("still refuses a bad expiry - that one does hurt someone", async () => {
    const { receiveGoodsSchema } = await import("@/server/validators/procurement");
    const r = receiveGoodsSchema.safeParse({
      supplierId: "s1",
      items: [{ medicineId: "m1", batchNo: "B1", expiryDate: "", qty: 10, unitCost: 1, mrp: 2 }],
    });
    expect(r.success).toBe(false);
  });
});

/**
 * ── THE FAILURE THAT PROMPTED THE FALLBACK TIERS ──
 *
 * A phone photo loses the RIGHT EDGE of the page - to shadow, to the curl of
 * the paper, to being framed a centimetre short. HSN and G% live on that edge.
 * The HSN-anchored parser is all-or-nothing, so losing them returned NOTHING,
 * on every line, while the header regexes (which scan the whole page for "Date:"
 * and a supplier name) still filled in perfectly.
 *
 * That is what "it only extracts the invoice date and the supplier name" is, and
 * it is a parser failure over text that was fully present.
 */
describe("an invoice photographed short of its right edge", () => {
  /** Chop N columns off the right of every line. */
  const crop = (t: string, n: number) =>
    t.split("\n").map((l) => l.split(" ").slice(0, -n).join(" ")).join("\n");

  it("still reads the lines when HSN and G% are gone", () => {
    const rows = parseInvoiceText(crop(P1, 2));
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const r = rows.find((x) => x.medicine.includes("DULCOFLEX TAB"))!;
    expect(r.batchNo).toBe("DLA26026");
    expect(r.qty).toBe("10");
    expect(r.mrp).toBe("18.59");
    expect(r.expiry).toBe("2029-02-28");
  });

  it("still reads the lines when the money columns are gone too", () => {
    const rows = parseInvoiceText(crop(P1, 4));
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.find((x) => x.medicine.includes("SUCRAFIL"))!.mrp).toBe("295.00");
  });

  it("marks a partial read as such, so the grid can flag it", () => {
    const clean = parseInvoiceText(P1);
    expect(clean.filter((r) => r.confidence === "high").length).toBeGreaterThanOrEqual(20);
    expect(clean.some((r) => r.confidence === "low")).toBe(false);
    expect(parseInvoiceText(crop(P1, 2)).every((r) => r.confidence === "medium")).toBe(true);
  });

  it("rescues a line whose last two columns OCR ran together", () => {
    // "5 300490" comes back as the single token "5300490", so there is no
    // 6-digit HSN to anchor on and the strict parser dropped the whole line -
    // one real consignment, silently absent from a delivery of 23.
    const r = parseInvoiceText(P1).find((x) => x.medicine.includes("DULCOFLEX SUPP ED"))!;
    expect(r).toBeDefined();
    expect(r.batchNo).toBe("SC26022");
    expect(r.mrp).toBe("53.59");
    expect(r.rate).toBe("42.87");
    expect(r.expiry).toBe("2026-03-31");
  });

  it("won't take a number inside a product name as the expiry", () => {
    // "ISTAMET 50/500" is the trap: it looks like MM/YY to a naive scan. The
    // anchor is searched RIGHT to LEFT and the year is bounded, so it can't win.
    const r = parseInvoiceText(crop(P1, 2)).find((x) => x.medicine.includes("50/500"))!;
    expect(r).toBeDefined();
    expect(r.expiry).toBe("2028-03-31");
    expect(r.qty).toBe("5");
  });
});

describe("an invoice whose expiry column is a smudge", () => {
  const smudged = P1.replace(/(?<=[\s|])\d{2}\/(2[6-9]|3\d)(?=[\s|])/g, "~~~");
  const rows = parseInvoiceText(smudged);

  it("recovers the rows rather than handing back an empty grid", () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it("leaves the expiry BLANK instead of guessing one", () => {
    // The grid paints an empty expiry red and refuses to import the row. That
    // is the point: a wrong expiry is a patient-safety problem, an empty one is
    // thirty seconds of typing.
    expect(rows.every((r) => r.expiry === "")).toBe(true);
    expect(rows.every((r) => r.confidence === "low")).toBe(true);
  });

  it("keeps everything that ISN'T the expiry", () => {
    const r = rows.find((x) => x.medicine.includes("SUCRAFIL"))!;
    expect(r.batchNo).toBe("P0300");
    expect(r.qty).toBe("2.5");
    expect(r.mrp).toBe("295.00");
    // Exactly as printed - 225.00, not 225. A price re-rendered from a float
    // loses its trailing zero, and a figure that doesn't match the paper is one
    // more thing to doubt for whoever is checking the row against the invoice.
    expect(r.rate).toBe("225.00");  // 225 x 2.5 = 562.50, which is the amount
  });

  it("finds the purchase rate by arithmetic, not by position", () => {
    // A smudged expiry still OCRs as a NUMBER ("03/28" -> 328), sitting exactly
    // where the rate should be. Taking the next number along would book the
    // purchase at that price - invisible, because stock still arrives and only
    // the margin report quietly lies. rate x qty must equal the line amount.
    const r = rows.find((x) => x.medicine.includes("MUCAINE"))!;
    expect(r.rate).toBe("210.04");
    expect(Number(r.rate) * Number(r.qty)).toBeCloseTo(Number(r.amount), 2);
  });

  it("still refuses the totals block", () => {
    // The loose tier is loose. Everything below the item table has to stay out.
    expect(rows.some((r) => /total|net|cgst|bank/i.test(r.medicine))).toBe(false);
  });
});

describe("the product's first word", () => {
  it("survives a serial number glued to it", () => {
    // OCR emits "12/CREMAFFIN PINK SYP" - no gutter between the SNO and the
    // name. Dropping the whole first token dropped CREMAFFIN with it, and
    // "PINK SYP" matches nothing in the catalog.
    const rows = parseInvoiceText(P1);
    expect(rows.some((r) => r.medicine.startsWith("CREMAFFIN PINK"))).toBe(true);
    expect(rows.some((r) => r.medicine.startsWith("PINK"))).toBe(false);
  });

  it("still drops a serial number that stands on its own", () => {
    const r = parseInvoiceText(P1).find((x) => x.medicine.includes("DULCOFLEX TAB"))!;
    expect(r.medicine).toBe("DULCOFLEX TAB");
  });
});
