import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { listSuppliers, upsertSupplier } from "@/server/services/procurement.service";
import { supplierSchema } from "@/server/validators/procurement";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireRole(req, "PHARMACIST", "ADMIN");
  const { searchParams } = new URL(req.url);
  return NextResponse.json({
    suppliers: await listSuppliers({
      includeInactive: searchParams.get("all") === "1",
      query: searchParams.get("q")?.trim() || undefined,
    }),
  });
});

export const POST = handler(async (req) => {
  const actor = await requireRole(req, "PHARMACIST", "ADMIN");
  const i = await parseBody(req, supplierSchema);
  const s = await upsertSupplier(actor, {
    ...i,
    contactPerson: i.contactPerson || undefined,
    phone: i.phone || undefined,
    email: i.email || undefined,
    address: i.address || undefined,
    gstin: i.gstin || undefined,
    drugLicenseNo: i.drugLicenseNo || undefined,
    notes: i.notes || undefined,
  }, auditContext(req));
  return NextResponse.json({ supplier: s }, { status: i.id ? 200 : 201 });
});
