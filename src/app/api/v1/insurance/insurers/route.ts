import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { insurerCatalogue, addInsurer, setInsurerActive } from "@/server/services/insurers.service";
import { addInsurerSchema, setInsurerActiveSchema } from "@/server/validators/insurance";

export const dynamic = "force-dynamic";

/**
 * CURATING THE LIST - the insurance desk's job, not reception's.
 *
 * Reception READS this list all day and must never be blocked by it (see
 * /api/v1/insurers, which any signed-in staff member may call). Deciding WHICH
 * TPAs the hospital deals with is a different act, done once in a while by the
 * people who talk to those TPAs, and it belongs to this desk.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  return NextResponse.json({ rows: await insurerCatalogue() });
});

/** Add a name this app had never heard of. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const input = await parseBody(req, addInsurerSchema);
  return NextResponse.json({ row: await addInsurer(actor, input, auditContext(req)) });
});

/**
 * Switch one on or off.
 *
 * PATCH on the collection with the name in the body, rather than on a row id:
 * the names that ship with the app have no row until the moment somebody hides
 * one, and an id-shaped route would have needed a second endpoint for half the
 * list. See setInsurerActive.
 */
export const PATCH = handler(async (req) => {
  const actor = await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const input = await parseBody(req, setInsurerActiveSchema);
  return NextResponse.json({ row: await setInsurerActive(actor, input, auditContext(req)) });
});
