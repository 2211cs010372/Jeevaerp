import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listServiceCharges, upsertServiceCharge } from "@/server/services/ipd.service";
import { serviceChargeSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/**
 * The published rate card for IPD procedures, surgeries, nursing and consumables.
 * ?all=1 includes retired services; without it, only active services.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK", "DOCTOR");
  const all = new URL(req.url).searchParams.get("all") === "1";
  const services = await listServiceCharges({ all });
  return NextResponse.json({ services });
});

/**
 * Create or update a service charge in the hospital's IPD rate card.
 */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const input = await parseBody(req, serviceChargeSchema);
  const service = await upsertServiceCharge(actor, input, auditContext(req));
  return NextResponse.json({ ok: true, service }, { status: 201 });
});
