import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { ipServicesBillData } from "@/server/services/ipd.service";

export const dynamic = "force-dynamic";

/**
 * The self-pay stay bill - the hospital's own services discounted, the pharmacy
 * and the lab at cost, and everything already collected taken off.
 *
 * SEPARATE FROM `/insurance/admissions/[id]/bill`, which is the claim sheet and
 * is unchanged. This one lives under /ipd because the desk that prints it is the
 * discharge counter, not the claims room - though the insurance desk is on the
 * guard too, since the stay it is most often wanted for is one they have just
 * finished arguing with a TPA about.
 *
 * The gate on WHO may be billed this way is in the service, not here: it depends
 * on the stay's payer and its claims, and a rule that lives in a route handler
 * is a rule the next caller does not get.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "INSURANCE_DESK", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json(await ipServicesBillData(id));
});
