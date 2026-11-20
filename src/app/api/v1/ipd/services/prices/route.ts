import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { bulkUpdateServicePrices } from "@/server/services/ipd.service";
import { serviceChargePricesSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/**
 * Bulk update rates on the IPD services rate card in one go.
 */
export const PUT = handler(async (req) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { updates } = await parseBody(req, serviceChargePricesSchema);
  const result = await bulkUpdateServicePrices(actor, updates, auditContext(req));
  return NextResponse.json({ ok: true, ...result });
});
