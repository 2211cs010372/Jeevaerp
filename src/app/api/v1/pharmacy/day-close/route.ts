import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { dayClose } from "@/server/services/reports.service";

export const dynamic = "force-dynamic";

/** The pharmacy's own drawer - money taken at the medicine window, whatever it was for. */
export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const date = new URL(req.url).searchParams.get("date") ?? undefined;
  return NextResponse.json(await dayClose({ dateISO: date, till: "PHARMACY" }));
});
