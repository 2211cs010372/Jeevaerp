import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { createClaim, listClaims, claimStats } from "@/server/services/insurance.service";
// The hospital's own list, not the hardcoded one - see insurers.service.
import { suggestedInsurers } from "@/server/services/insurers.service";
import { createClaimSchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/**
 * The insurance desk's own door onto the claims it works.
 *
 * Deliberately a separate route from /admin/insurance rather than a widened
 * guard on it: the admin route sits inside a console that also serves salaries,
 * the audit log and hospital settings, and "just let INSURANCE_DESK in there
 * too" is how a role ends up with more than its room.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const url = new URL(req.url);
  const [claims, stats, insurers] = await Promise.all([
    listClaims({ status: url.searchParams.get("status") ?? undefined, q: url.searchParams.get("q") ?? undefined }),
    claimStats(),
    suggestedInsurers(),
  ]);
  return NextResponse.json({ claims, stats, insurers });
});

/** Raise a new claim. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const input = await parseBody(req, createClaimSchema);
  const claim = await createClaim(actor, input, auditContext(req));
  return NextResponse.json({ claim }, { status: 201 });
});
