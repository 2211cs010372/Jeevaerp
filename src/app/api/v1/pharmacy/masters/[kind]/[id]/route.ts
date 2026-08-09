import { NextResponse } from "next/server";
import { handler, parseBody, ApiError } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { setMasterActive } from "@/server/services/pharmacy-masters.service";
import { masterKindSchema, setActiveSchema } from "@/server/validators/pharmacy-masters";

export const dynamic = "force-dynamic";

/**
 * Retire or restore a master row.
 *
 * PATCH rather than DELETE, and that is the whole point: a master is never
 * deleted. Retiring takes it out of the pickers and leaves every medicine
 * already pointing at it exactly as it was.
 */
export const PATCH = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { kind, id } = await ctx.params;
  const k = masterKindSchema.safeParse(kind);
  if (!k.success) throw new ApiError(404, `There is no "${kind}" master`);
  const { active } = await parseBody(req, setActiveSchema);
  await setMasterActive(actor, k.data, id, active, auditContext(req));
  return NextResponse.json({ ok: true });
});
