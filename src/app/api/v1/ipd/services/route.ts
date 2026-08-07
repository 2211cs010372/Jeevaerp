import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The published rate card, for the picker on any screen that adds a charge to a
 * stay. Grouped the way the board on the wall is grouped, because that is how
 * staff look a rate up.
 */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK", "DOCTOR");
  const rows = await prisma.serviceCharge.findMany({
    where: { active: true },
    orderBy: [{ group: "asc" }, { name: "asc" }],
    select: { id: true, name: true, group: true, category: true, price: true, gstRatePct: true, perDay: true },
  });
  return NextResponse.json({
    services: rows.map((r) => ({
      id: r.id, name: r.name, group: r.group, category: r.category,
      price: Number(r.price).toFixed(2), gstRatePct: Number(r.gstRatePct).toFixed(2), perDay: r.perDay,
    })),
  });
});
