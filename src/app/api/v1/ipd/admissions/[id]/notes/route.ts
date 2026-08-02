import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addAdmissionNote, listAdmissionNotes } from "@/server/services/ipd.service";
import { admissionNoteSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** The stay's nursing / observation chronology, oldest first. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  return NextResponse.json({ notes: await listAdmissionNotes(id) });
});

/**
 * Add one entry. POST, not PATCH: this APPENDS to a record, it does not amend
 * one. There is deliberately no update and no delete route here - a correction
 * is a new entry that says what it corrects, which is how it is done on paper
 * and the only version that survives a stay being questioned later.
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN");
  const { id } = await ctx.params;
  const { body } = await parseBody(req, admissionNoteSchema);
  const note = await addAdmissionNote(actor, id, body, auditContext(req));
  return NextResponse.json(note);
});
