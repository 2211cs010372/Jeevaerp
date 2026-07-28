import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { dayCloseByTill } from "@/server/services/reports.service";

export const dynamic = "force-dynamic";

/** Every counter's takings for one day, side by side, adding up to the hospital total. */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  return NextResponse.json(await dayCloseByTill(date));
});
