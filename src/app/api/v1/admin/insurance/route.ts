import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { createClaim, listClaims, claimStats } from "@/server/services/insurance.service";
// The hospital's own list, not the hardcoded one - see insurers.service.
import { suggestedInsurers } from "@/server/services/insurers.service";
import { createClaimSchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/** List claims (+ stats + the insurer directory). Admin only. */
export const GET = handler(async (req) => {
  await requireRole(req, "ADMIN");
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
  const actor = await requireRole(req, "ADMIN");
  const input = await parseBody(req, createClaimSchema);
  const claim = await createClaim(actor, input, auditContext(req));
  return NextResponse.json({ claim }, { status: 201 });
});
