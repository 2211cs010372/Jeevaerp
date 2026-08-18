import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import { addAdmissionNote, listAdmissionNotes } from "@/server/services/ipd.service";
import { admissionNoteSchema } from "@/server/validators/ipd";

export const dynamic = "force-dynamic";

/** The stay's nursing / observation chronology, oldest first. */
export const GET = handler(async (req, ctx) => {
  // INSURANCE_DESK: the claims desk works the whole stay from its own portal -
  // the same sheet, the same corrections, the same record - so it needs the
  // same reads and writes reception has. Deliberately widened; see the role
  // note on the Role enum for why this one is granted field by field.
  await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
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
  // INSURANCE_DESK: the claims desk works the whole stay from its own portal,
  // so it needs the same writes reception has. Granted field by field - see
  // the note on the Role enum for why this role is widened deliberately.
  const actor = await requireRole(req, "RECEPTIONIST", "ADMIN", "INSURANCE_DESK");
  const { id } = await ctx.params;
  const { body } = await parseBody(req, admissionNoteSchema);
  const note = await addAdmissionNote(actor, id, body, auditContext(req));
  return NextResponse.json(note);
});
