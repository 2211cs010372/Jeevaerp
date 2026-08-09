import { NextResponse } from "next/server";
import { handler, parseBody, ApiError } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listMasters, upsertMaster } from "@/server/services/pharmacy-masters.service";
import { masterKindSchema, masterSchema } from "@/server/validators/pharmacy-masters";

export const dynamic = "force-dynamic";

/** The kind comes off the URL, so it is validated before it reaches a switch. */
function parseKind(raw: string) {
  const r = masterKindSchema.safeParse(raw);
  if (!r.success) throw new ApiError(404, `There is no "${raw}" master`);
  return r.data;
}

export const GET = handler(async (req, ctx) => {
  await requireRole(req, "PHARMACIST", "ADMIN", "RECEPTIONIST");
  const { kind } = await ctx.params;
  const { searchParams } = new URL(req.url);
  return NextResponse.json({
    rows: await listMasters(parseKind(kind), {
      includeInactive: searchParams.get("all") === "1",
      query: searchParams.get("q")?.trim() || undefined,
    }),
  });
});

/** Create or edit one row. Pharmacist/admin only - reception may read, not write. */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const { kind } = await ctx.params;
  const input = await parseBody(req, masterSchema);
  const row = await upsertMaster(actor, parseKind(kind), input, auditContext(req));
  return NextResponse.json({ row }, { status: input.id ? 200 : 201 });
});
