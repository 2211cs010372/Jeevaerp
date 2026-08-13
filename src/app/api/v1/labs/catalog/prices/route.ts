import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { bulkUpdateCatalogPrices } from "@/server/services/admin.service";
import { labCatalogPricesSchema } from "@/server/validators/labs";
export const dynamic = "force-dynamic";

/**
 * Correct a whole page of prices in one submit.
 *
 * PUT rather than POST because this is not a new thing: every row it names
 * already exists, and sending the same body twice leaves the catalogue in the
 * same state. The service skips rows whose price did not move, so a resubmit
 * after a dropped connection writes nothing and logs nothing.
 *
 * RECEPTION IS ALLOWED HERE, AND THE SINGLE-ITEM POST NEXT DOOR IS NOT.
 *
 * That asymmetry is deliberate. This route can only move prices, and it records
 * every move; the POST next door can also rename a test, retire it, or change
 * its GST rate, which are the lab's and admin's decisions and stay theirs.
 *
 * The risk of opening it is real and worth naming: reception bills against these
 * rates, so a desk that can set them can discount a bill by editing the menu,
 * and that reduction never appears in the discount column a day close reads.
 * It is accepted because reception is where a wrong or ₹0 rate is actually
 * discovered - at the counter, in front of the patient, usually with nobody left
 * in the lab to correct it - and a test billed at ₹0 costs more than a rate a
 * receptionist fixed.
 *
 * What contains it is the audit row, not the guard: bulkUpdateCatalogPrices logs
 * CATALOG_PRICES_UPDATED with the actor and every before/after pair. If this
 * ever needs revisiting, that log is the evidence, and removing RECEPTIONIST
 * from this one line is the whole rollback.
 */
export const PUT = handler(async (req) => {
  const actor = await requireRole(req, "LAB_TECH", "RECEPTIONIST", "ADMIN");
  const { prices } = await parseBody(req, labCatalogPricesSchema);
  const { updated } = await bulkUpdateCatalogPrices(actor, prices, auditContext(req));
  return NextResponse.json({ ok: true, updated });
});
