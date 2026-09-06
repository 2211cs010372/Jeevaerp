import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { buildDailyReport, dailyReportStatus, sendDailyReport } from "@/server/services/daily-report.service";
import { renderReportHtml } from "@/lib/daily-report";
import { dailyReportSendSchema } from "@/server/validators/admin";

export const dynamic = "force-dynamic";
/** Same reasoning as the cron route: a dozen aggregates and two providers. */
export const maxDuration = 60;

/**
 * Whether the daily report can actually go out, and to whom.
 *
 * `?preview=1` also builds the report and renders the mail, so an admin can
 * read exactly what will be sent BEFORE spending a WhatsApp message on it. Kept
 * behind the flag because building it costs a dozen aggregate queries and the
 * settings card opens on every visit to that screen.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const url = new URL(req.url);
  const status = await dailyReportStatus();
  if (url.searchParams.get("preview") !== "1") return NextResponse.json({ status });

  const report = await buildDailyReport(url.searchParams.get("date") ?? undefined);
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
