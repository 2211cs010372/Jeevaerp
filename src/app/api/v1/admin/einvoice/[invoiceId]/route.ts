import { NextResponse } from "next/server";
import { handler, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth/guard";
import { auditContext } from "@/server/services/audit.service";
import {
  eInvoiceStatus, eInvoicePayloadFor, generateEInvoice, recordEInvoice, setInvoiceBuyer,
} from "@/server/services/einvoice.service";
import { recordEInvoiceSchema, setBuyerSchema } from "@/server/validators/einvoice";

export const dynamic = "force-dynamic";

/**
 * Where one bill stands with the IRP, and - with ?payload=1 - the exact document
 * that would be submitted, so an accountant registering by hand on the
 * government portal is typing from the same numbers this system would send.
 */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, "ADMIN");
  const { invoiceId } = await ctx.params;
  if (new URL(req.url).searchParams.get("payload") === "1") {
    return NextResponse.json({ payload: await eInvoicePayloadFor(invoiceId) });
  }
  return NextResponse.json({ eInvoice: await eInvoiceStatus(invoiceId) });
});

/**
 * Two actions on one route, chosen by `action`:
 *   generate - submit through the configured provider
 *   record   - store an IRN obtained on the portal by hand
 */
export const POST = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { invoiceId } = await ctx.params;
  const action = new URL(req.url).searchParams.get("action");

  if (action === "record") {
    const input = await parseBody(req, recordEInvoiceSchema);
    return NextResponse.json({ eInvoice: await recordEInvoice(actor, invoiceId, input, auditContext(req)) });
  }
  return NextResponse.json({ eInvoice: await generateEInvoice(actor, invoiceId, auditContext(req)) });
});

/** Set (or clear) the registered buyer - what makes a bill B2B. */
export const PUT = handler(async (req, ctx) => {
  const actor = await requireRole(req, "ADMIN");
  const { invoiceId } = await ctx.params;
  const { buyer } = await parseBody(req, setBuyerSchema);
  return NextResponse.json({ eInvoice: await setInvoiceBuyer(actor, invoiceId, buyer, auditContext(req)) });
});
