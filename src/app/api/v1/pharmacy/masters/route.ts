import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { allMasters } from "@/server/services/pharmacy-masters.service";

export const dynamic = "force-dynamic";

/**
 * Every master in one call.
 *
 * The medicine form needs all eight to render its pickers, and eight requests
 * on mount is eight chances for one to fail and leave a dropdown mysteriously
 * empty. Reception is on the guard because it reads the catalogue for
 * prescription autocomplete.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN", "RECEPTIONIST");
  return NextResponse.json({ masters: await allMasters() });
});
