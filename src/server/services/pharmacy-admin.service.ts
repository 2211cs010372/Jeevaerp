import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit.service";
import type { AuthUser } from "@/lib/auth/types";

/**
 * Create or edit a medicine. This is where the GST rate is set -
 * medicines ARE taxable in India (commonly 5%, some at 12%), unlike
 * diagnostic services which are exempt.
 */
export async function upsertMedicine(
  actor: AuthUser,
  input: {
    id?: string; name: string; genericName?: string; manufacturer?: string;
    hsnCode?: string; gstRatePct: number; unit: string;
    reorderThreshold: number; rackLocation?: string; active: boolean; courseCritical?: boolean;
    /// Procurement defaults: who we buy this from, and how much to bring the
    /// shelf up to when it drops. Both feed the reorder screen.
    preferredSupplierId?: string | null; reorderQty?: number | null;
    // ── MASTER LINKS ──
    // All optional. A form that does not send them leaves the existing links
    // alone; an empty string clears one. Nothing here is ever inferred - in
    // particular `scheduleId`, which is a regulatory fact about a product and
    // is only ever set by a human choosing it. See DrugSchedule in the schema.
    categoryId?: string | null; genericId?: string | null; manufacturerId?: string | null;
    dosageFormId?: string | null; unitId?: string | null; hsnId?: string | null;
    taxRateId?: string | null; scheduleId?: string | null;
  },
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  /**
   * A link field is only written when the caller mentioned it.
   *
   * `undefined` means "not my business" and must leave an existing link intact -
   * otherwise any caller that predates these columns would silently unlink every
   * master on every save. `""` is the explicit "clear it" the forms send.
   */
  const link = (v: string | null | undefined) => (v === undefined ? undefined : v || null);

  const data = {
    name: input.name,
    genericName: input.genericName || null,
    manufacturer: input.manufacturer || null,
    hsnCode: input.hsnCode || null,
    gstRatePct: input.gstRatePct.toFixed(2),
    unit: input.unit,
    reorderThreshold: input.reorderThreshold,
    rackLocation: input.rackLocation || null,
    active: input.active,
    courseCritical: input.courseCritical ?? false,
    preferredSupplierId: input.preferredSupplierId || null,
    reorderQty: input.reorderQty && input.reorderQty > 0 ? input.reorderQty : null,
    categoryId: link(input.categoryId),
    genericId: link(input.genericId),
    manufacturerId: link(input.manufacturerId),
    dosageFormId: link(input.dosageFormId),
    unitId: link(input.unitId),
    hsnId: link(input.hsnId),
    taxRateId: link(input.taxRateId),
    scheduleId: link(input.scheduleId),
  };

  if (input.id) {
    await prisma.medicine.update({ where: { id: input.id }, data });
    await logAudit(actor, { action: "MEDICINE_UPDATED", targetTable: "Medicine", targetId: input.id, meta: { gstRatePct: input.gstRatePct }, ...ctx });
  } else {
    const created = await prisma.medicine.create({ data, select: { id: true } });
    await logAudit(actor, { action: "MEDICINE_CREATED", targetTable: "Medicine", targetId: created.id, ...ctx });
  }
}
