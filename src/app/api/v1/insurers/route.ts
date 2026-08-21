import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireAuth } from "@/lib/auth/guard";
import { suggestedInsurers } from "@/server/services/insurers.service";

export const dynamic = "force-dynamic";

/**
 * The names every "Insurer / TPA" box suggests.
 *
 * ANY SIGNED-IN STAFF MEMBER, not just the insurance desk. The busiest reader of
 * this list is reception's admission form, and the second is the ward board -
 * neither of those desks is an insurance role, and gating the list behind one
 * would mean the box that decides whether a stay ever reaches the claims desk
 * is the box that comes up empty.
 *
 * There is nothing confidential in it: it is a list of companies, and it is the
 * same list printed on every hoarding outside the hospital.
 */
export const GET = handler(async (req) => {
  await requireAuth(req);
  return NextResponse.json({ insurers: await suggestedInsurers() });
});
