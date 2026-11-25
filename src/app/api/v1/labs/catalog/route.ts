import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listCatalog } from "@/server/services/labs.service";
// The SAME functions admin/catalog calls. Not a labs copy of them: one
// catalogue, one write path, so the two screens cannot drift apart. See the
// note on upsertCatalogItem.
import { listAllCatalog, upsertCatalogItem } from "@/server/services/admin.service";
import { labCatalogItemSchema } from "@/server/validators/labs";
import { uniqueTestCode } from "@/lib/lab-code";
export const dynamic = "force-dynamic";

/**
 * `?all=1` includes retired tests; without it, only what can be ordered today.
 *
 * The default is the narrow one because the ordering and billing screens are
 * the callers that were here first, and a retired test appearing in an order
 * picker is a test somebody raises by mistake. The catalogue MANAGEMENT screen
 * is the one caller that needs the rest - you cannot bring a test back if the
 * list it vanished from is the only list you can see.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "LAB_TECH", "RECEPTIONIST", "PHARMACIST", "INSURANCE_DESK", "ADMIN");
  const all = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json({ catalog: all ? await listAllCatalog() : await listCatalog() });
});

/**
 * Create or correct a test from the lab's own catalogue tab.
 *
 * RECEPTIONIST is not on this guard although they can READ the catalogue above:
 * the front desk orders and bills against these prices, and a desk that can
 * also set them is a desk that can discount a bill by editing the menu.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "LAB_TECH", "ADMIN");
  const i = await parseBody(req, labCatalogItemSchema);

  // A code the technician did not type is derived from the test's name, checked
  // against the ones already in use. The screen suggests the same string as they
  // type, so this is normally just confirming it - but it is done HERE as well
  // because the uniqueness check needs the whole catalogue, which the browser
  // does not have, and because a code is not optional: the seed upserts on it
  // and the printed report finds a test's department and specimen band by it.
  let code = i.code?.trim() || undefined;
  if (!code) {
    const existing = await listAllCatalog();
    code = uniqueTestCode(i.name, existing.map((c) => c.code)) || undefined;
  }

  // No gstRatePct: an update leaves the admin's rate alone, a create starts
  // exempt. See upsertCatalogItem.
  await upsertCatalogItem(actor, { ...i, code }, auditContext(req));
  return NextResponse.json({ ok: true, code }, { status: 201 });
});
