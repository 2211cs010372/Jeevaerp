import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { buildDailyReport, dailyReportStatus, sendDailyReport } from "@/server/services/daily-report.service";
import { renderReportHtml } from "@/lib/daily-report";
import { renderReportPdf, reportPdfFilename } from "@/lib/daily-report-pdf";
import { dailyReportSendSchema } from "@/server/validators/admin";

export const dynamic = "force-dynamic";
/** Same reasoning as the cron route: a dozen aggregates and two providers. */
export const maxDuration = 60;

/**
 * Whether the daily report can actually go out, and to whom.
 *
 * `?preview=1` also builds the report and renders the mail, and `?pdf=1`
 * returns the attached statement itself - so an admin can read exactly what
 * will be sent BEFORE spending a WhatsApp message on it. Both are behind flags
 * because building the report costs a dozen aggregate queries and the settings
 * card opens on every visit to that screen.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? undefined;

  if (url.searchParams.get("pdf") === "1") {
    const report = await buildDailyReport(date);
    const bytes = await renderReportPdf(report);
    // `inline` so it opens in the browser's own viewer rather than landing in
    // the downloads folder - this is a look, not a filing.
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${reportPdfFilename(report)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const status = await dailyReportStatus();
  if (url.searchParams.get("preview") !== "1") return NextResponse.json({ status });

  const report = await buildDailyReport(date);
  return NextResponse.json({ status, report, html: renderReportHtml(report) });
});

/**
 * Send it now.
 *
 * Deliberately ignores the "daily report enabled" switch - an admin pressing
 * this button is asking for it explicitly, and they are looking at the screen
 * that holds the switch. See sendDailyReport.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "ADMIN");
  const { date } = await parseBody(req, dailyReportSendSchema);
  const result = await sendDailyReport({
    dateISO: date,
    trigger: "manual",
    actor,
    ctx: auditContext(req),
  });
  return NextResponse.json(result);
});
