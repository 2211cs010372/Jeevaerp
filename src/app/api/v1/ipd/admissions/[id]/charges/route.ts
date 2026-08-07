import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addAdmissionCharge } from "@/server/services/ipd.service";
import { addChargeSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

export const POST = handler(async (req, ctx) => {
  // The insurance desk adds lines too: a policy can cover an item the ward never
  // billed separately, and it has to be on the bill before the claim goes out.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, addChargeSchema);
  await addAdmissionCharge(actor, { admissionId: id, ...input }, auditContext(req));
  return NextResponse.json({ ok: true }, { status: 201 });
});
