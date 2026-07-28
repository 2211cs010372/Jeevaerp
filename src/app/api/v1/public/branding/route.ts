import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { getBranding } from "@/server/services/admin.service";
export const dynamic = "force-dynamic";

/**
 * Logo and brand for the portal shells and the sign-in screens.
 *
 * Deliberately unauthenticated, and in the `public` namespace to say so: a login
 * page has to render the hospital's logo before anyone has signed in, and a name
 * plus a logo is not information worth gating - it is on the side of the
 * building. Nothing else from HospitalConfig is exposed here. The GSTIN, address
 * and every operational switch stay behind the ADMIN-only config route.
 */
export const GET = handler(async () => {
  const branding = await getBranding();
  return NextResponse.json(branding, {
    // Changes about once a year; requested on every portal page load.
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=600" },
  });
});
