import { NextResponse } from "next/server";
import { ApiError, handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addForgottenBill } from "@/server/services/ipd.service";
import { forgottenBillSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** A forgotten LAB / PHARMACY bill, SERVICE or ADVANCE for this stay - see addForgottenBill. */
export const POST = handler(async (req, ctx) => {
  // PHARMACIST: the pharmacy counter adds its own forgotten medicine bills to a
  // stay (owner, 1 Oct 2026) - and only those. Lab, services and advances stay
  // with reception and the insurance desk, who bill them everywhere else.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK", "PHARMACIST");
  const { id } = await ctx.params;
  const input = await parseBody(req, forgottenBillSchema);
  if (actor.role === "PHARMACIST" && input.kind !== "PHARMACY") {
    throw new ApiError(403, "The pharmacy counter adds medicine bills only.");
  }
  return NextResponse.json(await addForgottenBill(actor, id, input, auditContext(req)), { status: 201 });
});
