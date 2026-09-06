import { describe, it, expect } from "vitest";
import { renderReportPdf, reportPdfFilename, glyphSafe } from "@/lib/daily-report-pdf";
import type { DailyReport } from "@/lib/daily-report";

/** A day with something in every section, so a renderer that drops one fails here. */
function report(over: Partial<DailyReport> = {}): DailyReport {
  return {
    date: "2026-09-05",
    generatedAt: "2026-09-05T16:00:00.000Z",
    hospital: { name: "Jeeva Multi Speciality Hospital" },
    money: {
      collected: 197193, refunded: 28957, net: 168236, cash: 171005,
      payments: 118, bills: 92, insuranceBills: 2, insuranceAmount: 141000,
      insurerReceipts: 160000,
      tills: [
        { label: "Reception", collected: 90000, refunded: 28957, net: 61043, cash: 30000, digital: 31043, bills: 51 },
        { label: "Pharmacy", collected: 84203, refunded: 0, net: 84203, cash: 80000, digital: 4203, bills: 41 },
      ],
      modes: [
        { mode: "CASH", collected: 171005, refunded: 0, net: 171005, count: 88 },
        { mode: "UPI", collected: 26188, refunded: 28957, net: -2769, count: 30 },
      ],
      bySource: [
        { source: "CONSULTATION", net: 40000, count: 30 },
        { source: "PHARMACY", net: 84203, count: 41 },
      ],
    },
    billing: {
      billed: 191883, billCount: 92, discountGiven: 4200,
      cancelled: 1, cancelledValue: 1800, dueFromToday: 1000, dueTotal: 32212,
    },
    opd: { booked: 18, completed: 0, cancelled: 1, newPatients: 35 },
    ipd: {
      admissions: 2, closures: 2,
      closureKinds: [{ status: "DISCHARGED", count: 1 }, { status: "TRANSFERRED_OUT", count: 1 }],
      inHouse: 15, beds: { total: 34, occupied: 15, free: 19 },
      advances: 17000, advanceCount: 3,
    },
    lab: { ordered: 105, completed: 76, pending: 367 },
    pharmacy: {
      sales: 84203, billCount: 41, profit: 60396, marginPct: 75.3,
      lowStock: 294, outOfStock: 14, expiringSoon: 3,
    },
    doctors: [
      { doctor: "Dr. A Santhosh", department: "General Medicine", visits: 20, revenue: 43001 },
      { doctor: "Dr. Shireesha Ch", department: "Gynaecology", visits: 4, revenue: 30609 },
    ],
    insurance: { claimsRaised: 1, claimsRaisedValue: 141000, claimsSettled: 1, claimsSettledValue: 160000 },
    alerts: ["14 medicines are out of stock", "Rs 28,957 refunded today across 1 refund"],
    ...over,
  };
}

/** The first bytes of every PDF ever written. */
const isPdf = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString("latin1") === "%PDF-";

describe("glyphSafe - Geist Mono's latin subset has no rupee sign", () => {
  it("turns the rupee sign into Rs rather than throwing at the encoder", () => {
    // Checked against the font, not assumed: U+20B9 has no glyph in the latin
    // subset, and pdf-lib THROWS on a missing glyph rather than dropping it.
    expect(glyphSafe("₹1,46,000")).toBe("Rs1,46,000");
  });

  it("keeps the punctuation this sheet is actually ruled with", () => {
    expect(glyphSafe("Reception · cash")).toBe("Reception · cash");
    expect(glyphSafe("a – b — c − d")).toBe("a – b — c − d");
  });

  it("normalises smart quotes and drops anything the subset cannot draw", () => {
    expect(glyphSafe("‘x’ “y”")).toBe("'x' \"y\"");
    expect(glyphSafe("Dr నాగ Ravi")).toBe("Dr  Ravi");
  });
});

describe("renderReportPdf", () => {
  it("produces a real PDF", async () => {
    const bytes = await renderReportPdf(report());
    expect(isPdf(bytes)).toBe(true);
    // Two embedded font subsets plus a page of rules - a file materially
    // smaller than this means something failed to draw.
    expect(bytes.byteLength).toBeGreaterThan(8_000);
  });

  it("never throws on a name carrying characters the font does not have", async () => {
    // The failure this guards: one doctor with an unusual character in their
    // name taking the whole night's attachment down with it.
    const bytes = await renderReportPdf(report({
      hospital: { name: "జీవ Hospital ₹" },
      doctors: [{ doctor: "Dr. Ravi — “Ravi” ₹", department: "Медицина", visits: 1, revenue: 500 }],
    }));
    expect(isPdf(bytes)).toBe(true);
  });

  it("renders a day with nothing in it", async () => {
    const empty = report({
      money: { ...report().money, modes: [], bySource: [], tills: [] },
      doctors: [],
      alerts: [],
    });
    expect(isPdf(await renderReportPdf(empty))).toBe(true);
  });

  it("adds pages instead of overflowing when the doctor list is long", async () => {
    const many = report({
      doctors: Array.from({ length: 60 }, (_, i) => ({
        doctor: `Dr. Number ${i + 1}`, department: "General Medicine", visits: i, revenue: i * 100,
      })),
    });
    const one = await renderReportPdf(report());
    const lots = await renderReportPdf(many);
    expect(isPdf(lots)).toBe(true);
    expect(lots.byteLength).toBeGreaterThan(one.byteLength);
  });

  it("names the file by the day it reports on", () => {
    expect(reportPdfFilename(report())).toBe("jeeva-daily-report-2026-09-05.pdf");
  });
});
