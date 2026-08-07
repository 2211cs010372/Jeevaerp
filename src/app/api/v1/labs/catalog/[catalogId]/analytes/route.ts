import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listCatalogAnalytes, replaceCatalogAnalytes } from "@/server/services/admin.service";
import { catalogAnalytesSchema } from "@/server/validators/labs";

export const dynamic = "force-dynamic";

/**
 * The normal values a test reports - the template the results form is built
 * from, and the ranges a result is flagged against.
 *
 * Readable by the desk as well as the bench: reception raises orders against
 * this catalogue and is asked what a test actually reports often enough that
 * hiding it would just mean a phone call to the lab.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN");
  const { catalogId } = await ctx.params;
  return NextResponse.json({ analytes: await listCatalogAnalytes(catalogId) });
});

/**
 * Replace them - PUT, not PATCH, because a row the technician deleted has to be
 * expressible, and only sending the whole set can say "this one is gone".
 *
 * Writing is the bench's and admin's alone. Reception reads these to answer a
 * question at the window; the ranges a result is judged against are not a front
 * desk decision.
 */
export const PUT = handler(async (req, ctx) => {
  const actor = await requireRole(req, "LAB_TECH", "ADMIN");
  const { catalogId } = await ctx.params;
  const { analytes } = await parseBody(req, catalogAnalytesSchema);
  await replaceCatalogAnalytes(actor, catalogId, analytes, auditContext(req));
  return NextResponse.json({ analytes: await listCatalogAnalytes(catalogId) });
});
