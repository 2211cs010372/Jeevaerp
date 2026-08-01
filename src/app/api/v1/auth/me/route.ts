import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireAuth } from "@/lib/auth/guard";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * The signed-in user: the greeting and real name in the shell, and the profile
 * card under Settings.
 *
 * Own-account only - it reads whoever the token says is calling and takes no id,
 * so there is no shape of this request that returns somebody else's contact
 * details. Contact fields are the account's own (where a code is emailed, which
 * number the hospital has on file), which is exactly what a person needs to see
 * to notice that one of them is wrong and ask an admin to fix it. No password
 * material of any kind is selected.
 */
export const GET = handler(async (req) => {
  const auth = await requireAuth(req);
  if (auth.role === "PATIENT") {
    const p = await prisma.patient.findUnique({
      where: { id: auth.id },
      select: { fullName: true, displayId: true, phone: true },
    });
    return NextResponse.json({
      name: p?.fullName ?? "Patient", role: auth.role, username: p?.displayId ?? null,
      email: null, phone: p?.phone ?? null, lastLoginAt: null,
    });
  }
  const u = await prisma.user.findUnique({
    where: { id: auth.id },
    select: { name: true, username: true, role: true, email: true, phone: true, lastLoginAt: true },
  });
  return NextResponse.json({
    name: u?.name ?? "there",
    role: u?.role ?? auth.role,
    username: u?.username ?? null,
    email: u?.email ?? null,
    phone: u?.phone ?? null,
    lastLoginAt: u?.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  });
});
