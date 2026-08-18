import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { insuranceStays } from "@/server/services/insurance.service";

export const dynamic = "force-dynamic";

/**
 * Every insurance stay, needing work or not - the desk's patient list.
 *
 * `?payer=SELF_PAY` (or `ALL`) widens it to families who paid the counter
 * themselves, so a REIMBURSEMENT claim can be raised against the actual stay
 * rather than reconstructed by hand on the claims board. Anything unrecognised
 * falls back to the cashless list, which is the safe default: this desk is
 * accountable for cashless stays and merely helpful on the rest.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const raw = new URL(req.url).searchParams.get("payer");
  const payer = raw === "SELF_PAY" || raw === "ALL" ? raw : "INSURANCE";
  return NextResponse.json(await insuranceStays({ payer }));
});
