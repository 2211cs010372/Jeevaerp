import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listMedicines } from "@/server/services/pharmacy.service";
import { upsertMedicine } from "@/server/services/pharmacy-admin.service";
import { medicineSchema } from "@/server/validators/pharmacy";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  // Reception reads this for autocomplete while transcribing a handwritten
  // prescription. Writes below stay pharmacist/admin-only.
  await requireRole(req, "PHARMACIST", "ADMIN", "RECEPTIONIST");
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  return NextResponse.json({ medicines: await listMedicines(q) });
});

/** Add or edit a medicine - this is where the GST rate (5% / 12%) is set. */
export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, medicineSchema);
  await upsertMedicine(actor, {
    ...i,
    genericName: i.genericName || undefined,
    manufacturer: i.manufacturer || undefined,
    hsnCode: i.hsnCode || undefined,
    rackLocation: i.rackLocation || undefined,
    preferredSupplierId: i.preferredSupplierId || null,
    reorderQty: i.reorderQty ?? null,
    // Passed through undefined-vs-"" intact: the service uses that distinction
    // to tell "leave the pack alone" from "clear it".
    defaultPack: i.defaultPack,
    // Passed through as-is: `undefined` (key absent) must stay undefined so the
    // service leaves the existing link alone, while "" clears it. Coercing to
    // null here would unlink every master on every save from an older client.
    categoryId: i.categoryId, genericId: i.genericId, manufacturerId: i.manufacturerId,
    dosageFormId: i.dosageFormId, unitId: i.unitId, hsnId: i.hsnId,
    taxRateId: i.taxRateId, scheduleId: i.scheduleId,
  }, auditContext(req));
  return NextResponse.json({ ok: true }, { status: 201 });
});
