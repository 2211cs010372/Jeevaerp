import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { stayBills, redateBill } from "@/server/services/insurance.service";
import { redateBillSchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/** Every bill on the stay, oldest first, flagged if dated outside the stay. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const { id } = await ctx.params;
  return NextResponse.json(await stayBills(id));
});

/** Correct a bill's date before the claim goes out. */
export const PATCH = handler(async (req) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN", "RECEPTIONIST");
  const input = await parseBody(req, redateBillSchema);
  const result = await redateBill(actor, input, auditContext(req));
  return NextResponse.json(result);
});
