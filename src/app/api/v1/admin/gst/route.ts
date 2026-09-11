import { NextRequest, NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import {
  getDailyGstReport,
  getMonthlyGstReport,
  getYearlyGstReport,
  buildGstCsv,
} from "@/server/services/gst-report.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/admin/gst
 * Query params:
 *   mode = "daily" | "monthly" | "yearly"
 *   date = "YYYY-MM-DD" (for daily)
 *   month = 1..12 (for monthly)
 *   year = YYYY (for monthly & yearly)
 *   fy = "true" | "false" (for yearly - financial year vs calendar year)
 *   download = "csv" (returns attachment)
 */
export const GET = handler(async (req: NextRequest) => {
  await requireRole(req, "ADMIN");
  const url = new URL(req.url);

  const mode = url.searchParams.get("mode") || "monthly";
  const download = url.searchParams.get("download");

  const today = new Date();
  const dateStr = url.searchParams.get("date") || today.toISOString().slice(0, 10);
  const year = Number(url.searchParams.get("year") || today.getFullYear());
  const month = Number(url.searchParams.get("month") || today.getMonth() + 1);
  const fy = url.searchParams.get("fy") !== "false";

  if (mode === "daily") {
    const report = await getDailyGstReport(dateStr);
    return NextResponse.json(report);
  }

  if (mode === "yearly") {
    const report = await getYearlyGstReport(year, fy);
    return NextResponse.json(report);
  }

  // Default: monthly report
  const report = await getMonthlyGstReport(year, month);

  if (download === "csv") {
    const csv = buildGstCsv(report);
    const filename = `GST-Report-${report.monthName}-${report.year}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(report);
});
