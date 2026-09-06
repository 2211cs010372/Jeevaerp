import { NextResponse } from "next/server";
import { handler, ApiError } from "@/lib/api";
import { sendDailyReport } from "@/server/services/daily-report.service";

export const dynamic = "force-dynamic";
/**
 * The report runs a dozen aggregate queries and then waits on two external
 * providers. The default 10-second function limit is not enough on a day with a
 * few hundred bills, and a timeout here looks exactly like a provider outage.
 */
export const maxDuration = 60;

/**
 * THE NIGHTLY DAILY REPORT.
 *
 * Scheduled in vercel.json as `0 16 * * *`. Vercel calls this with GET and,
 * when CRON_SECRET is set on the project, an `Authorization: Bearer
 * <CRON_SECRET>` header.
 *
 * ─── THE SCHEDULE, WHICH vercel.json CANNOT EXPLAIN ITSELF ─────────────────
 * 16:00 UTC = 9:30 PM IST - after the evening OP clinic has closed and the
 * counters have been counted. Vercel schedules are UTC ONLY and do not follow
 * IST, and India has no daylight saving, so that one line is right all year.
 * On the Hobby plan a cron fires once a day somewhere INSIDE its hour rather
 * than on the minute; the report is for a whole day, so that is harmless -
 * but it is why the mail says "generated at" rather than promising 9:30.
 *
 * ─── FAILS CLOSED WHEN THERE IS NO SECRET ──────────────────────────────────
 * This endpoint reads the whole hospital's takings and then MAILS them. An
 * unauthenticated URL that does that is a data leak with a schedule attached,
 * so a missing CRON_SECRET is refused rather than treated as "no auth
 * required". The alternative - trusting Vercel's `x-vercel-cron` header - is a
 * header, and headers are typed by whoever is calling.
 */
function requireCronSecret(req: Request): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron:daily-report] refused: CRON_SECRET is not set on this deployment");
    throw new ApiError(503, "Scheduled reports are not configured");
  }
  const header = req.headers.get("authorization")?.trim() ?? "";
  if (header !== `Bearer ${secret}`) throw new ApiError(401, "Not authorised");
}

export const GET = handler(async (req) => {
  requireCronSecret(req);
  // `?date=YYYY-MM-DD` re-sends an earlier day - the manual recovery when a
  // night's run was missed. Absent means today, which is what the cron sends.
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  const result = await sendDailyReport({ dateISO: date, trigger: "cron" });
  // Always 200 when the run itself completed, even if a channel failed: a
  // scheduler that sees a 500 retries, and a retried report is a second copy of
  // the same numbers in fifteen inboxes. The body says what happened.
  return NextResponse.json(result);
});
