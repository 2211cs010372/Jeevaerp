import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { getSettings } from "@/server/services/admin.service";

export const dynamic = "force-dynamic";

/**
 * THE OPERATIONAL SWITCHES, READABLE BY THE DESKS THEY GOVERN.
 *
 * /admin/config is the whole hospital record - GSTIN, address, Tally ledger
 * names - and is ADMIN-only for good reason. But a receptionist's screen has to
 * know whether the Edit button should be drawn at all, and asking an admin-only
 * endpoint from a reception page returns 403 and a screen that silently renders
 * the safer branch for the wrong reason.
 *
 * So: the narrow operational set, readable by any signed-in staff member. None
 * of it is sensitive - "may this desk edit bills" is a fact about the building,
 * not about a patient.
 *
 * This is a CONVENIENCE for the UI and never a permission. Every switch here is
 * enforced again on the write path (see assertMayEditBills in billing.service);
 * a client that lies about this response gets a 403 from the endpoint that
 * matters.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "DOCTOR", "INSURANCE_DESK", "ADMIN");
  return NextResponse.json({ settings: await getSettings() });
});
