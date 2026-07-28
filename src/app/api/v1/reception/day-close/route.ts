import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { dayClose, type Till } from "@/server/services/reports.service";

export const dynamic = "force-dynamic";

const TILLS: Till[] = ["RECEPTION", "PHARMACY", "LAB", "ADMIN"];

/**
 * What should physically be in a drawer right now.
 *
 * Serves every counter, scoped to the caller. It used to return the whole
 * hospital's takings to whoever asked, which meant a receptionist counting their
 * drawer was handed a figure including money they never touched - including the
 * pharmacy's. Now a pharmacist gets the pharmacy till, a lab tech the lab till.
 *
 * `?till=` is honoured for ADMIN only, and `?till=ALL` gives the hospital-wide
 * view the owner needs.
 */
export const GET = handler(async (req) => {
  const actor = await requireRole(req, "RECEPTIONIST", "PHARMACIST", "LAB_TECH", "ADMIN");
  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? undefined;
  const asked = url.searchParams.get("till")?.toUpperCase();

  let till: Till | undefined;
  if (actor.role === "ADMIN") {
    // The owner may look at any drawer, or all of them at once.
    till = asked === "ALL" ? undefined
      : asked && TILLS.includes(asked as Till) ? (asked as Till)
      : undefined;
  } else {
    // Everyone else counts their own drawer, whatever they ask for.
    till = actor.role === "PHARMACIST" ? "PHARMACY"
      : actor.role === "LAB_TECH" ? "LAB"
      : "RECEPTION";
  }

  return NextResponse.json(await dayClose({ dateISO: date, till }));
});
