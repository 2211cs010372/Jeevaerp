import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { deleteCatalogItem } from "@/server/services/admin.service";

export const dynamic = "force-dynamic";

/**
 * Remove a test from the catalogue for good.
 *
 * ONLY A ROW NOTHING POINTS AT. The service refuses the moment the test has
 * been ordered or sits on a doctor's advice line, and says how many times - see
 * deleteCatalogItem for why that is a refusal and not a cascade. The ordinary
 * way to get a test off the ordering screens is to retire it, which this does
 * not replace; this is for the one somebody typed twice.
 *
 * LAB_TECH and ADMIN, the same guard the POST above it carries. Reception can
 * read the catalogue and order against it, and a desk that can also delete from
 * it is a desk that can make a test it just billed for disappear.
 */
export const DELETE = handler(async (req, ctx) => {
  const actor = await requireRole(req, "LAB_TECH", "ADMIN");
  const { catalogId } = await ctx.params;
  const { name } = await deleteCatalogItem(actor, catalogId, auditContext(req));
  return NextResponse.json({ ok: true, name });
});
