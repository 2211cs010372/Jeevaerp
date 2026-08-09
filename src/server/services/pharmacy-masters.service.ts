import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logAudit } from "./audit.service";
import { MASTER_META, type MasterKind } from "@/lib/pharmacy/masters";
import type { AuthUser } from "@/lib/auth/types";

/**
 * THE PHARMACY'S VOCABULARIES, MANAGED.
 *
 * Eight lookup tables behind one service, because they are the same shape of
 * problem eight times over and eight near-identical services would drift apart
 * within a month.
 *
 * Two rules run through all of it:
 *
 *   NOTHING IS EVER DELETED. A master row is retired by clearing `active`, which
 *   takes it out of the pickers and leaves every medicine already pointing at it
 *   untouched. Deleting would either orphan products or, with ON DELETE SET
 *   NULL, silently blank a descriptor somebody had entered - and the first
 *   anyone would know is a label printing without a manufacturer.
 *
 *   `usedBy` IS ALWAYS REPORTED. "Can I retire this?" is the only question
 *   anybody asks on these screens, and it cannot be answered without knowing how
 *   many products depend on the row.
 */

export interface MasterRowDTO {
  id: string;
  /** `name` for most, `code` for HSN and schedules. */
  label: string;
  /** The secondary line - whatever that master's own extra field is. */
  detail: string | null;
  active: boolean;
  /** Medicines pointing at this row. Drives the retire confirmation. */
  usedBy: number;
  /** Kind-specific fields, for the edit form. */
  extra: Record<string, string | number | boolean | null>;
}

/** Trim, and treat an empty string as "not given" rather than as a value. */
const s = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/** Name/code collisions are the whole reason these tables exist. */
async function assertNoDuplicate(
  kind: MasterKind, field: "name" | "code", value: string, exceptId?: string
): Promise<void> {
  const where = { [field]: value } as Record<string, string>;
  const existing = await (async () => {
    switch (kind) {
      case "category": return prisma.medicineCategory.findFirst({ where, select: { id: true } });
      case "generic": return prisma.generic.findFirst({ where, select: { id: true } });
      case "manufacturer": return prisma.manufacturer.findFirst({ where, select: { id: true } });
      case "dosageForm": return prisma.dosageForm.findFirst({ where, select: { id: true } });
      case "unit": return prisma.unitOfMeasure.findFirst({ where, select: { id: true } });
      case "tax": return prisma.taxRate.findFirst({ where, select: { id: true } });
      case "hsn": return prisma.hsnCode.findFirst({ where, select: { id: true } });
      case "schedule": return prisma.drugSchedule.findFirst({ where, select: { id: true } });
    }
  })();
  if (existing && existing.id !== exceptId) {
    throw new ApiError(409, `"${value}" already exists under ${MASTER_META[kind].title}.`);
  }
}

export async function listMasters(
  kind: MasterKind,
  opts?: { includeInactive?: boolean; query?: string }
): Promise<MasterRowDTO[]> {
  const inactive = opts?.includeInactive ? {} : { active: true };
  const q = opts?.query?.trim();
  const like = (field: string) =>
    q ? { [field]: { contains: q, mode: "insensitive" as const } } : {};
  const count = { medicines: true } as const;

  switch (kind) {
    case "category": {
      const rows = await prisma.medicineCategory.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { name: "asc" }], take: 300,
        select: { id: true, name: true, description: true, active: true, _count: { select: count } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name, detail: r.description, active: r.active,
        usedBy: r._count.medicines, extra: { description: r.description },
      }));
    }
    case "generic": {
      const rows = await prisma.generic.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { name: "asc" }], take: 300,
        select: { id: true, name: true, strength: true, description: true, active: true, _count: { select: count } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name,
        detail: [r.strength, r.description].filter(Boolean).join(" · ") || null,
        active: r.active, usedBy: r._count.medicines,
        extra: { strength: r.strength, description: r.description },
      }));
    }
    case "manufacturer": {
      const rows = await prisma.manufacturer.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { name: "asc" }], take: 300,
        select: { id: true, name: true, shortCode: true, address: true, phone: true, active: true, _count: { select: count } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name,
        detail: [r.shortCode, r.phone].filter(Boolean).join(" · ") || null,
        active: r.active, usedBy: r._count.medicines,
        extra: { shortCode: r.shortCode, address: r.address, phone: r.phone },
      }));
    }
    case "dosageForm": {
      const rows = await prisma.dosageForm.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { name: "asc" }], take: 300,
        select: { id: true, name: true, active: true, _count: { select: count } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name, detail: null, active: r.active,
        usedBy: r._count.medicines, extra: {},
      }));
    }
    case "unit": {
      const rows = await prisma.unitOfMeasure.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { name: "asc" }], take: 300,
        select: { id: true, name: true, symbol: true, active: true, _count: { select: count } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name, detail: r.symbol, active: r.active,
        usedBy: r._count.medicines, extra: { symbol: r.symbol },
      }));
    }
    case "tax": {
      const rows = await prisma.taxRate.findMany({
        where: { ...inactive, ...like("name") },
        orderBy: [{ active: "desc" }, { ratePct: "asc" }], take: 300,
        select: { id: true, name: true, ratePct: true, active: true, _count: { select: { medicines: true, hsnCodes: true } } },
      });
      return rows.map((r) => ({
        id: r.id, label: r.name, detail: `${Number(r.ratePct).toFixed(2)}%`, active: r.active,
        // HSN codes defaulting to this rate depend on it just as products do.
        usedBy: r._count.medicines + r._count.hsnCodes,
        extra: { ratePct: Number(r.ratePct).toFixed(2) },
      }));
    }
    case "hsn": {
      const rows = await prisma.hsnCode.findMany({
        where: { ...inactive, ...like("code") },
        orderBy: [{ active: "desc" }, { code: "asc" }], take: 300,
        select: {
          id: true, code: true, description: true, active: true,
          defaultTaxRateId: true, defaultTaxRate: { select: { name: true, ratePct: true } },
          _count: { select: count },
        },
      });
      return rows.map((r) => ({
        id: r.id, label: r.code,
        detail: [r.description, r.defaultTaxRate ? `${Number(r.defaultTaxRate.ratePct).toFixed(2)}%` : null]
          .filter(Boolean).join(" · ") || null,
        active: r.active, usedBy: r._count.medicines,
        extra: { description: r.description, defaultTaxRateId: r.defaultTaxRateId },
      }));
    }
    case "schedule": {
      const rows = await prisma.drugSchedule.findMany({
        where: { ...inactive, ...like("code") },
        orderBy: [{ active: "desc" }, { code: "asc" }], take: 300,
        select: {
          id: true, code: true, description: true, requiresPrescription: true,
          retentionYears: true, active: true, _count: { select: count },
        },
      });
      return rows.map((r) => ({
        id: r.id, label: r.code, detail: r.description, active: r.active,
        usedBy: r._count.medicines,
        extra: { description: r.description, requiresPrescription: r.requiresPrescription, retentionYears: r.retentionYears },
      }));
    }
  }
}

/** Every master, in one call - what a picker-heavy form needs on mount. */
export async function allMasters(): Promise<Record<MasterKind, MasterRowDTO[]>> {
  const [category, generic, manufacturer, dosageForm, unit, tax, hsn, schedule] = await Promise.all([
    listMasters("category"), listMasters("generic"), listMasters("manufacturer"),
    listMasters("dosageForm"), listMasters("unit"), listMasters("tax"),
    listMasters("hsn"), listMasters("schedule"),
  ]);
  return { category, generic, manufacturer, dosageForm, unit, tax, hsn, schedule };
}

export interface MasterInput {
  id?: string;
  label: string;
  active?: boolean;
  description?: string | null;
  strength?: string | null;
  shortCode?: string | null;
  address?: string | null;
  phone?: string | null;
  symbol?: string | null;
  ratePct?: number | null;
  defaultTaxRateId?: string | null;
  requiresPrescription?: boolean | null;
  retentionYears?: number | null;
}

export async function upsertMaster(
  actor: AuthUser,
  kind: MasterKind,
  input: MasterInput,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<{ id: string; label: string }> {
  const meta = MASTER_META[kind];
  const label = s(input.label);
  if (!label) throw new ApiError(400, `Give the ${meta.singular.toLowerCase()} a ${meta.labelField}`);
  await assertNoDuplicate(kind, meta.labelField, label, input.id);

  const active = input.active ?? true;
  let id: string;

  switch (kind) {
    case "category": {
      const data = { name: label, description: s(input.description), active };
      id = input.id
        ? (await prisma.medicineCategory.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.medicineCategory.create({ data, select: { id: true } })).id;
      break;
    }
    case "generic": {
      const data = { name: label, strength: s(input.strength), description: s(input.description), active };
      id = input.id
        ? (await prisma.generic.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.generic.create({ data, select: { id: true } })).id;
      break;
    }
    case "manufacturer": {
      const data = { name: label, shortCode: s(input.shortCode), address: s(input.address), phone: s(input.phone), active };
      id = input.id
        ? (await prisma.manufacturer.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.manufacturer.create({ data, select: { id: true } })).id;
      break;
    }
    case "dosageForm": {
      const data = { name: label, active };
      id = input.id
        ? (await prisma.dosageForm.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.dosageForm.create({ data, select: { id: true } })).id;
      break;
    }
    case "unit": {
      const data = { name: label, symbol: s(input.symbol), active };
      id = input.id
        ? (await prisma.unitOfMeasure.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.unitOfMeasure.create({ data, select: { id: true } })).id;
      break;
    }
    case "tax": {
      if (input.ratePct == null || input.ratePct < 0 || input.ratePct > 28) {
        throw new ApiError(400, "Enter a GST rate between 0 and 28");
      }
      const data = { name: label, ratePct: input.ratePct.toFixed(2), active };
      id = input.id
        ? (await prisma.taxRate.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.taxRate.create({ data, select: { id: true } })).id;
      break;
    }
    case "hsn": {
      const data = {
        code: label, description: s(input.description),
        defaultTaxRateId: s(input.defaultTaxRateId), active,
      };
      id = input.id
        ? (await prisma.hsnCode.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.hsnCode.create({ data, select: { id: true } })).id;
      break;
    }
    case "schedule": {
      const data = {
        code: label, description: s(input.description),
        requiresPrescription: input.requiresPrescription ?? true,
        retentionYears: input.retentionYears && input.retentionYears > 0 ? input.retentionYears : null,
        active,
      };
      id = input.id
        ? (await prisma.drugSchedule.update({ where: { id: input.id }, data, select: { id: true } })).id
        : (await prisma.drugSchedule.create({ data, select: { id: true } })).id;
      break;
    }
  }

  await logAudit(actor, {
    action: input.id ? "PHARMACY_MASTER_UPDATED" : "PHARMACY_MASTER_CREATED",
    targetTable: kind, targetId: id, meta: { kind, label }, ...ctx,
  });
  return { id, label };
}

/**
 * Retire or restore a master row.
 *
 * Retiring takes it out of every picker and leaves every medicine already
 * pointing at it exactly as it was. There is no delete on purpose - see the
 * note at the top of this file.
 */
export async function setMasterActive(
  actor: AuthUser,
  kind: MasterKind,
  id: string,
  active: boolean,
  ctx: { ipAddress?: string; userAgent?: string }
): Promise<void> {
  const data = { active };
  switch (kind) {
    case "category": await prisma.medicineCategory.update({ where: { id }, data }); break;
    case "generic": await prisma.generic.update({ where: { id }, data }); break;
    case "manufacturer": await prisma.manufacturer.update({ where: { id }, data }); break;
    case "dosageForm": await prisma.dosageForm.update({ where: { id }, data }); break;
    case "unit": await prisma.unitOfMeasure.update({ where: { id }, data }); break;
    case "tax": await prisma.taxRate.update({ where: { id }, data }); break;
    case "hsn": await prisma.hsnCode.update({ where: { id }, data }); break;
    case "schedule": await prisma.drugSchedule.update({ where: { id }, data }); break;
  }
  await logAudit(actor, {
    action: active ? "PHARMACY_MASTER_RESTORED" : "PHARMACY_MASTER_RETIRED",
    targetTable: kind, targetId: id, meta: { kind }, ...ctx,
  });
}
