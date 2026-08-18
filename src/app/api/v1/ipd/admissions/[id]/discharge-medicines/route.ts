import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { getDischargeMedicines, setDischargeMedicines } from "@/server/services/ipd.service";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * The medicines a patient goes home on, written on the discharge summary.
 *
 * DOCTOR is on the guard because this is a clinical instruction, not a clerical
 * one - and reception and the insurance desk are here too because both of them
 * type this summary up from the doctor's sheet in practice.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK");
  const { id } = await ctx.params;
  return NextResponse.json({ medicines: await getDischargeMedicines(id) });
});

const bodySchema = z.object({
  medicines: z.array(z.object({
    medicineName: z.string().trim().min(1, "Name the medicine").max(120),
    qty: z.coerce.number().int().min(1).max(1000),
    dosage: z.string().trim().max(120).optional(),
  // A discharge list longer than this is a transcription error, not a prescription.
  })).max(40),
});

export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "DOCTOR", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const input = await parseBody(req, bodySchema);
  return NextResponse.json(await setDischargeMedicines(actor, id, input.medicines, auditContext(req)));
});
