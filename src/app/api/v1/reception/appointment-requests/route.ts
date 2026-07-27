import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { listCallbackRequests, openRequestCount } from "@/server/services/appointment-requests.service";

export const dynamic = "force-dynamic";

/** The desk's callback queue. `?status=NEW|CONTACTED|BOOKED|CLOSED|ALL`. */
export const GET = handler(async (req) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const [requests, open] = await Promise.all([
    listCallbackRequests({ status }),
    openRequestCount(),
  ]);
  return NextResponse.json({ requests, open });
});
