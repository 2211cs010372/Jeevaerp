import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { buildTallyExport } from "@/server/services/tally-export.service";
import { tallyExportSchema } from "@/server/validators/einvoice";

export const dynamic = "force-dynamic";

/**
 * The Tally import file for a date range.
 *
 * Two shapes, chosen by ?download=1:
 *   without - JSON with the counts and anything skipped, so the screen can show
 *             what the file contains BEFORE the accountant imports it
 *   with    - the raw XML as an attachment
 *
 * The preview matters. An accountant who imports 400 vouchers and only then
 * discovers that 12 bills were skipped has to unpick it inside Tally, which is
 * far harder than reading a list first.
 */
export const GET = handler(async (req) => {
  const actor = await requireRole(req, "ADMIN");
  const url = new URL(req.url);
  const { from, to } = tallyExportSchema.parse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });

  const result = await buildTallyExport(actor, { from, to }, auditContext(req));

  if (url.searchParams.get("download") === "1") {
    return new NextResponse(result.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    filename: result.filename,
    counts: result.counts,
    skipped: result.skipped,
    vouchers: result.counts.sales + result.counts.receipts + result.counts.creditNotes,
  });
});
