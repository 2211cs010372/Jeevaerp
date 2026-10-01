import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { searchPatients } from "@/server/services/reception.service";

export const dynamic = "force-dynamic";

/** Patient lookup for raising a claim by hand (a walk-in reimbursement, say). */
export const GET = handler(async (req) => {
  await requireRole(req, "INSURANCE_DESK", "ADMIN");
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const patients = await searchPatients(q);
  return NextResponse.json({ patients });
});
