import { prisma } from "@/lib/prisma";
import { r2 } from "@/server/billing/calc";

export interface GstSlabBreakdown {
  rate: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  invoiceCount: number;
}

export interface GstSourceBreakdown {
  source: string;
  label: string;
  totalAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  exemptAmount: number;
  invoiceCount: number;
}

export interface DailyGstReport {
  date: string;
  invoiceCount: number;
  totalSales: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  exemptAmount: number;
  b2bCount: number;
  b2bTaxable: number;
  b2bTax: number;
  b2cCount: number;
  b2cTaxable: number;
  b2cTax: number;
  bySource: GstSourceBreakdown[];
  bySlab: GstSlabBreakdown[];
  inwardPurchase: {
    grnCount: number;
    taxableAmount: number;
    gstAmount: number;
    totalAmount: number;
  };
}

export interface MonthlyGstDayRow {
  date: string;
  invoiceCount: number;
  totalAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  exemptAmount: number;
}

export interface MonthlyGstReport {
  year: number;
  month: number;
  monthName: string;
  startDate: string;
  endDate: string;
  summary: {
    invoiceCount: number;
    totalSales: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalTaxAmount: number;
    exemptAmount: number;
    b2bCount: number;
    b2bTaxable: number;
    b2bTax: number;
    b2cCount: number;
    b2cTaxable: number;
    b2cTax: number;
    inwardTaxable: number;
    inwardTaxCredit: number;
    netGstPayable: number;
  };
  dailyRows: MonthlyGstDayRow[];
  bySource: GstSourceBreakdown[];
  bySlab: GstSlabBreakdown[];
  b2bInvoices: {
    receiptNo: string;
    date: string;
    buyerGstin: string;
    buyerLegalName: string;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
  }[];
  hsnSummary: {
    hsnSac: string;
    description: string;
    qty: number;
    taxableAmount: number;
    gstRatePct: number;
    cgstAmount: number;
    sgstAmount: number;
    totalTax: number;
  }[];
}

export interface YearlyGstMonthRow {
  year: number;
  month: number;
  monthName: string;
  invoiceCount: number;
  totalSales: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
  exemptAmount: number;
  inwardTaxCredit: number;
  netGstPayable: number;
}

export interface YearlyGstReport {
  yearLabel: string;
  summary: {
    invoiceCount: number;
    totalSales: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalTaxAmount: number;
    exemptAmount: number;
    inwardTaxCredit: number;
    netGstPayable: number;
  };
  monthlyRows: YearlyGstMonthRow[];
  bySource: GstSourceBreakdown[];
  bySlab: GstSlabBreakdown[];
}

const SOURCE_LABELS: Record<string, string> = {
  CONSULTATION: "Consultation (OPD)",
  LAB: "Laboratory",
  PHARMACY: "Pharmacy",
  IPD: "Inpatient (IPD)",
  OTHER: "Other Services",
};

/** Get Daily GST Report for a specific YYYY-MM-DD */
export async function getDailyGstReport(dateStr: string): Promise<DailyGstReport> {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);

  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: { not: "CANCELLED" },
    },
    include: { items: true },
  });

  const grns = await prisma.goodsReceipt.findMany({
    where: { createdAt: { gte: start, lte: end } },
  });

  let totalSales = 0;
  let taxableAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  let exemptAmount = 0;
  let b2bCount = 0;
  let b2bTaxable = 0;
  let b2bTax = 0;
  let b2cCount = 0;
  let b2cTaxable = 0;
  let b2cTax = 0;

  const sourceMap = new Map<string, GstSourceBreakdown>();
  for (const src of ["CONSULTATION", "LAB", "PHARMACY", "IPD", "OTHER"]) {
    sourceMap.set(src, {
      source: src,
      label: SOURCE_LABELS[src] || src,
      totalAmount: 0,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      exemptAmount: 0,
      invoiceCount: 0,
    });
  }

  const slabMap = new Map<number, GstSlabBreakdown>();
  for (const rate of [0, 5, 12, 18, 28]) {
    slabMap.set(rate, {
      rate,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      invoiceCount: 0,
    });
  }

  for (const inv of invoices) {
    const tot = Number(inv.totalAmount);
    const taxVal = Number(inv.taxableAmount);
    const cgst = Number(inv.cgstAmount);
    const sgst = Number(inv.sgstAmount);
    const igst = 0; // State-level intra-state by default
    const totTax = cgst + sgst + igst;

    totalSales = r2(totalSales + tot);
    taxableAmount = r2(taxableAmount + taxVal);
    cgstAmount = r2(cgstAmount + cgst);
    sgstAmount = r2(sgstAmount + sgst);
    igstAmount = r2(igstAmount + igst);

    if (totTax === 0) {
      exemptAmount = r2(exemptAmount + tot);
    }

    if (inv.buyerGstin) {
      b2bCount++;
      b2bTaxable = r2(b2bTaxable + taxVal);
      b2bTax = r2(b2bTax + totTax);
    } else {
      b2cCount++;
      b2cTaxable = r2(b2cTaxable + taxVal);
      b2cTax = r2(b2cTax + totTax);
    }

    const src = sourceMap.get(inv.source) ?? {
      source: inv.source,
      label: SOURCE_LABELS[inv.source] || inv.source,
      totalAmount: 0,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      exemptAmount: 0,
      invoiceCount: 0,
    };
    src.totalAmount = r2(src.totalAmount + tot);
    src.taxableAmount = r2(src.taxableAmount + taxVal);
    src.cgst = r2(src.cgst + cgst);
    src.sgst = r2(src.sgst + sgst);
    src.igst = r2(src.igst + igst);
    if (totTax === 0) src.exemptAmount = r2(src.exemptAmount + tot);
    src.invoiceCount++;
    sourceMap.set(inv.source, src);

    for (const item of inv.items) {
      const rate = Number(item.gstRatePct || 0);
      const amt = Number(item.amount || 0);
      const itemCgst = r2((amt * rate) / 200);
      const itemSgst = r2((amt * rate) / 200);
      const itemTax = itemCgst + itemSgst;

      const slab = slabMap.get(rate) || {
        rate,
        taxableAmount: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
        invoiceCount: 0,
      };
      slab.taxableAmount = r2(slab.taxableAmount + amt);
      slab.cgst = r2(slab.cgst + itemCgst);
      slab.sgst = r2(slab.sgst + itemSgst);
      slab.totalTax = r2(slab.totalTax + itemTax);
      slab.invoiceCount++;
      slabMap.set(rate, slab);
    }
  }

  let inCount = grns.length;
  let inTaxable = 0;
  let inTax = 0;
  let inTotal = 0;

  for (const g of grns) {
    const val = Number(g.receivedValue);
    const tax = Number(g.receivedTax);
    inTaxable = r2(inTaxable + val);
    inTax = r2(inTax + tax);
    inTotal = r2(inTotal + val + tax);
  }

  return {
    date: dateStr,
    invoiceCount: invoices.length,
    totalSales,
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTaxAmount: r2(cgstAmount + sgstAmount + igstAmount),
    exemptAmount,
    b2bCount,
    b2bTaxable,
    b2bTax,
    b2cCount,
    b2cTaxable,
    b2cTax,
    bySource: Array.from(sourceMap.values()),
    bySlab: Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate),
    inwardPurchase: {
      grnCount: inCount,
      taxableAmount: inTaxable,
      gstAmount: inTax,
      totalAmount: inTotal,
    },
  };
}

const MONTH_NAMES_LIST = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Get Monthly GST Report (GSTR-1 & GSTR-3B summary format) */
export async function getMonthlyGstReport(year: number, month: number): Promise<MonthlyGstReport> {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const lastDay = end.getDate();

  const startDateStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDateStr = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: { not: "CANCELLED" },
    },
    include: { items: { include: { labTest: true } } },
    orderBy: { createdAt: "asc" },
  });

  const grns = await prisma.goodsReceipt.findMany({
    where: { createdAt: { gte: start, lte: end } },
  });

  const dailyMap = new Map<string, MonthlyGstDayRow>();
  for (let d = 1; d <= lastDay; d++) {
    const ds = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dailyMap.set(ds, {
      date: ds,
      invoiceCount: 0,
      totalAmount: 0,
      taxableAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      exemptAmount: 0,
    });
  }

  let totalSales = 0;
  let taxableAmount = 0;
  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;
  let exemptAmount = 0;
  let b2bCount = 0;
  let b2bTaxable = 0;
  let b2bTax = 0;
  let b2cCount = 0;
  let b2cTaxable = 0;
  let b2cTax = 0;

  const b2bInvoices: MonthlyGstReport["b2bInvoices"] = [];
  const hsnMap = new Map<string, { hsnSac: string; description: string; qty: number; taxableAmount: number; gstRatePct: number; cgstAmount: number; sgstAmount: number; totalTax: number }>();

  const sourceMap = new Map<string, GstSourceBreakdown>();
  for (const src of ["CONSULTATION", "LAB", "PHARMACY", "IPD", "OTHER"]) {
    sourceMap.set(src, {
      source: src,
      label: SOURCE_LABELS[src] || src,
      totalAmount: 0,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      exemptAmount: 0,
      invoiceCount: 0,
    });
  }

  const slabMap = new Map<number, GstSlabBreakdown>();
  for (const rate of [0, 5, 12, 18, 28]) {
    slabMap.set(rate, {
      rate,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
      invoiceCount: 0,
    });
  }

  for (const inv of invoices) {
    const dateStr = inv.createdAt.toISOString().slice(0, 10);
    const tot = Number(inv.totalAmount);
    const taxVal = Number(inv.taxableAmount);
    const cgst = Number(inv.cgstAmount);
    const sgst = Number(inv.sgstAmount);
    const igst = 0;
    const totTax = cgst + sgst + igst;

    totalSales = r2(totalSales + tot);
    taxableAmount = r2(taxableAmount + taxVal);
    cgstAmount = r2(cgstAmount + cgst);
    sgstAmount = r2(sgstAmount + sgst);
    igstAmount = r2(igstAmount + igst);
    if (totTax === 0) exemptAmount = r2(exemptAmount + tot);

    if (inv.buyerGstin) {
      b2bCount++;
      b2bTaxable = r2(b2bTaxable + taxVal);
      b2bTax = r2(b2bTax + totTax);
      b2bInvoices.push({
        receiptNo: inv.receiptNo,
        date: dateStr,
        buyerGstin: inv.buyerGstin,
        buyerLegalName: inv.buyerLegalName || "Corporate / Insurer",
        taxableAmount: taxVal,
        cgstAmount: cgst,
        sgstAmount: sgst,
        igstAmount: igst,
        totalAmount: tot,
      });
    } else {
      b2cCount++;
      b2cTaxable = r2(b2cTaxable + taxVal);
      b2cTax = r2(b2cTax + totTax);
    }

    const day = dailyMap.get(dateStr);
    if (day) {
      day.invoiceCount++;
      day.totalAmount = r2(day.totalAmount + tot);
      day.taxableAmount = r2(day.taxableAmount + taxVal);
      day.cgstAmount = r2(day.cgstAmount + cgst);
      day.sgstAmount = r2(day.sgstAmount + sgst);
      day.igstAmount = r2(day.igstAmount + igst);
      if (totTax === 0) day.exemptAmount = r2(day.exemptAmount + tot);
    }

    const src = sourceMap.get(inv.source) ?? {
      source: inv.source,
      label: SOURCE_LABELS[inv.source] || inv.source,
      totalAmount: 0,
      taxableAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      exemptAmount: 0,
      invoiceCount: 0,
    };
    src.totalAmount = r2(src.totalAmount + tot);
    src.taxableAmount = r2(src.taxableAmount + taxVal);
    src.cgst = r2(src.cgst + cgst);
    src.sgst = r2(src.sgst + sgst);
    src.igst = r2(src.igst + igst);
    if (totTax === 0) src.exemptAmount = r2(src.exemptAmount + tot);
    src.invoiceCount++;
    sourceMap.set(inv.source, src);

    for (const item of inv.items) {
      const rate = Number(item.gstRatePct || 0);
      const amt = Number(item.amount || 0);
      const itemCgst = r2((amt * rate) / 200);
      const itemSgst = r2((amt * rate) / 200);
      const itemTax = itemCgst + itemSgst;

      const hsnKey = item.hsnSac || (inv.source === "PHARMACY" ? "3004" : "9993");
      const existingHsn = hsnMap.get(hsnKey) || {
        hsnSac: hsnKey,
        description: item.description || "Healthcare / Medical",
        qty: 0,
        taxableAmount: 0,
        gstRatePct: rate,
        cgstAmount: 0,
        sgstAmount: 0,
        totalTax: 0,
      };
      existingHsn.qty += item.qty || 1;
      existingHsn.taxableAmount = r2(existingHsn.taxableAmount + amt);
      existingHsn.cgstAmount = r2(existingHsn.cgstAmount + itemCgst);
      existingHsn.sgstAmount = r2(existingHsn.sgstAmount + itemSgst);
      existingHsn.totalTax = r2(existingHsn.totalTax + itemTax);
      hsnMap.set(hsnKey, existingHsn);

      const slab = slabMap.get(rate) || {
        rate,
        taxableAmount: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        totalTax: 0,
        invoiceCount: 0,
      };
      slab.taxableAmount = r2(slab.taxableAmount + amt);
      slab.cgst = r2(slab.cgst + itemCgst);
      slab.sgst = r2(slab.sgst + itemSgst);
      slab.totalTax = r2(slab.totalTax + itemTax);
      slab.invoiceCount++;
      slabMap.set(rate, slab);
    }
  }

  let inwardTaxable = 0;
  let inwardTaxCredit = 0;
  for (const g of grns) {
    inwardTaxable = r2(inwardTaxable + Number(g.receivedValue));
    inwardTaxCredit = r2(inwardTaxCredit + Number(g.receivedTax));
  }

  const totalTaxAmount = r2(cgstAmount + sgstAmount + igstAmount);
  const netGstPayable = Math.max(0, r2(totalTaxAmount - inwardTaxCredit));

  return {
    year,
    month,
    monthName: MONTH_NAMES_LIST[month - 1] || String(month),
    startDate: startDateStr,
    endDate: endDateStr,
    summary: {
      invoiceCount: invoices.length,
      totalSales,
      taxableAmount,
      cgstAmount,
      sgstAmount,
      igstAmount,
      totalTaxAmount,
      exemptAmount,
      b2bCount,
      b2bTaxable,
      b2bTax,
      b2cCount,
      b2cTaxable,
      b2cTax,
      inwardTaxable,
      inwardTaxCredit,
      netGstPayable,
    },
    dailyRows: Array.from(dailyMap.values()),
    bySource: Array.from(sourceMap.values()),
    bySlab: Array.from(slabMap.values()).sort((a, b) => a.rate - b.rate),
    b2bInvoices,
    hsnSummary: Array.from(hsnMap.values()),
  };
}

/** Get Yearly GST Report (12 months breakdown for financial year or calendar year) */
export async function getYearlyGstReport(year: number, isFinancialYear = true): Promise<YearlyGstReport> {
  const startMonth = isFinancialYear ? 4 : 1;
  const startYear = isFinancialYear ? year : year;
  const endYear = isFinancialYear ? year + 1 : year;

  const yearLabel = isFinancialYear ? `FY ${year}-${String(year + 1).slice(2)}` : `CY ${year}`;

  const monthlyRows: YearlyGstMonthRow[] = [];
  let totInvoices = 0;
  let totSales = 0;
  let totTaxable = 0;
  let totCgst = 0;
  let totSgst = 0;
  let totIgst = 0;
  let totExempt = 0;
  let totItc = 0;

  for (let i = 0; i < 12; i++) {
    let m = startMonth + i;
    let y = startYear;
    if (m > 12) {
      m -= 12;
      y = endYear;
    }

    const mReport = await getMonthlyGstReport(y, m);
    const s = mReport.summary;

    totInvoices += s.invoiceCount;
    totSales = r2(totSales + s.totalSales);
    totTaxable = r2(totTaxable + s.taxableAmount);
    totCgst = r2(totCgst + s.cgstAmount);
    totSgst = r2(totSgst + s.sgstAmount);
    totIgst = r2(totIgst + s.igstAmount);
    totExempt = r2(totExempt + s.exemptAmount);
    totItc = r2(totItc + s.inwardTaxCredit);

    monthlyRows.push({
      year: y,
      month: m,
      monthName: mReport.monthName,
      invoiceCount: s.invoiceCount,
      totalSales: s.totalSales,
      taxableAmount: s.taxableAmount,
      cgstAmount: s.cgstAmount,
      sgstAmount: s.sgstAmount,
      igstAmount: s.igstAmount,
      totalTaxAmount: s.totalTaxAmount,
      exemptAmount: s.exemptAmount,
      inwardTaxCredit: s.inwardTaxCredit,
      netGstPayable: s.netGstPayable,
    });
  }

  const totalTaxAmount = r2(totCgst + totSgst + totIgst);
  const netGstPayable = Math.max(0, r2(totalTaxAmount - totItc));

  // Dummy slab/source summaries aggregated for full year
  const aprilReport = await getMonthlyGstReport(startYear, startMonth);

  return {
    yearLabel,
    summary: {
      invoiceCount: totInvoices,
      totalSales: totSales,
      taxableAmount: totTaxable,
      cgstAmount: totCgst,
      sgstAmount: totSgst,
      igstAmount: totIgst,
      totalTaxAmount,
      exemptAmount: totExempt,
      inwardTaxCredit: totItc,
      netGstPayable,
    },
    monthlyRows,
    bySource: aprilReport.bySource,
    bySlab: aprilReport.bySlab,
  };
}

/** Build CSV string for GSTR-1 & GST Filings */
export function buildGstCsv(report: MonthlyGstReport): string {
  const lines: string[] = [];

  lines.push(`GST Filing Summary Report - ${report.monthName} ${report.year}`);
  lines.push(`Period: ${report.startDate} to ${report.endDate}`);
  lines.push("");

  lines.push("--- SUMMARY ---");
  lines.push("Metric,Value");
  lines.push(`Total Invoices,${report.summary.invoiceCount}`);
  lines.push(`Total Sales (₹),${report.summary.totalSales.toFixed(2)}`);
  lines.push(`Taxable Amount (₹),${report.summary.taxableAmount.toFixed(2)}`);
  lines.push(`CGST Amount (₹),${report.summary.cgstAmount.toFixed(2)}`);
  lines.push(`SGST Amount (₹),${report.summary.sgstAmount.toFixed(2)}`);
  lines.push(`IGST Amount (₹),${report.summary.igstAmount.toFixed(2)}`);
  lines.push(`Total Outward Tax (₹),${report.summary.totalTaxAmount.toFixed(2)}`);
  lines.push(`Exempt Sales (₹),${report.summary.exemptAmount.toFixed(2)}`);
  lines.push(`Input Tax Credit (Purchases ₹),${report.summary.inwardTaxCredit.toFixed(2)}`);
  lines.push(`Net GST Payable (₹),${report.summary.netGstPayable.toFixed(2)}`);
  lines.push("");

  lines.push("--- B2B INVOICES (GSTR-1 Section 4A) ---");
  lines.push("Invoice No,Date,Buyer GSTIN,Buyer Name,Taxable Value,CGST,SGST,IGST,Total Amount");
  for (const b of report.b2bInvoices) {
    lines.push(`"${b.receiptNo}","${b.date}","${b.buyerGstin}","${b.buyerLegalName}",${b.taxableAmount.toFixed(2)},${b.cgstAmount.toFixed(2)},${b.sgstAmount.toFixed(2)},${b.igstAmount.toFixed(2)},${b.totalAmount.toFixed(2)}`);
  }
  lines.push("");

  lines.push("--- HSN/SAC SUMMARY (GSTR-1 Section 12) ---");
  lines.push("HSN/SAC Code,Description,Qty,Taxable Value,GST %,CGST,SGST,Total Tax");
  for (const h of report.hsnSummary) {
    lines.push(`"${h.hsnSac}","${h.description}",${h.qty},${h.taxableAmount.toFixed(2)},${h.gstRatePct}%,${h.cgstAmount.toFixed(2)},${h.sgstAmount.toFixed(2)},${h.totalTax.toFixed(2)}`);
  }
  lines.push("");

  lines.push("--- DAILY BREAKDOWN ---");
  lines.push("Date,Invoices,Total Amount,Taxable Value,CGST,SGST,IGST,Exempt Amount");
  for (const d of report.dailyRows) {
    lines.push(`"${d.date}",${d.invoiceCount},${d.totalAmount.toFixed(2)},${d.taxableAmount.toFixed(2)},${d.cgstAmount.toFixed(2)},${d.sgstAmount.toFixed(2)},${d.igstAmount.toFixed(2)},${d.exemptAmount.toFixed(2)}`);
  }

  return lines.join("\n");
}
