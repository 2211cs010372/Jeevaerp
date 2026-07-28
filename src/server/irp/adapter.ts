/**
 * The seam between this system and the Invoice Registration Portal.
 *
 * There is no single way to reach the IRP. A hospital either goes direct to
 * NIC (which requires enrolment and IP whitelisting), or through a GSP -
 * ClearTax, Masters India, and a dozen others - each with its own auth dance
 * and its own JSON envelope around the same government payload. Which one a
 * given hospital uses is a commercial decision, not a technical one, and it
 * changes.
 *
 * So the rest of the system talks to THIS interface and never to a provider.
 * Adding a GSP is one file implementing `IrpAdapter` plus one line in the
 * registry below; nothing in the service layer, the routes or the UI changes.
 *
 * Every adapter returns a result rather than throwing on rejection. An IRP
 * saying "no, that GSTIN is wrong" is an ordinary business outcome that has to
 * be recorded against the invoice and shown to a human - it is not an
 * exception, and treating it as one loses the error code that says how to fix
 * it.
 */

import type { EInvoicePayload } from "@/lib/gst/einvoice-payload";

/** What the portal gives back when it accepts an invoice. */
export interface IrpSuccess {
  ok: true;
  /** The 64-character Invoice Reference Number. */
  irn: string;
  ackNo: string;
  ackDt: Date;
  /** Verbatim, signed by the government. Never reformat this. */
  signedQrCode: string;
  signedInvoice?: string | null;
}

/** What it gives back when it doesn't. */
export interface IrpFailure {
  ok: false;
  /** The portal's own code, e.g. "2150" for a duplicate IRN. */
  errorCode: string;
  errorMessage: string;
}

export type IrpResult = IrpSuccess | IrpFailure;

export interface IrpCancelResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface IrpAdapter {
  /** Name recorded on the EInvoice row, so history survives a config change. */
  readonly name: string;
  /**
   * True when this adapter can reach the portal by itself. The manual adapter
   * cannot, and callers use this to decide whether to offer a "Generate" button
   * or a form to paste the portal's response into.
   */
  readonly automatic: boolean;

  generate(payload: EInvoicePayload): Promise<IrpResult>;
  cancel(irn: string, reason: string, remarks?: string): Promise<IrpCancelResult>;
}

/**
 * The default route: a human does it.
 *
 * This is not a stub standing in for real work. A hospital raising a handful of
 * B2B bills a month - which describes most of them, since almost all hospital
 * revenue is B2C and exempt - has no reason to pay for a GSP contract. The
 * accountant registers those few invoices on the government portal or the free
 * NIC offline tool and pastes the IRN, acknowledgement and signed QR back here.
 * The invoice still prints correctly and the hospital is still compliant.
 *
 * `generate` therefore refuses rather than pretending. Returning a fabricated
 * IRN would be worse than useless: it would print on a bill and give the
 * hospital false confidence that a supply had been registered when it had not.
 */
export class ManualIrpAdapter implements IrpAdapter {
  readonly name = "MANUAL";
  readonly automatic = false;

  async generate(): Promise<IrpResult> {
    return {
      ok: false,
      errorCode: "MANUAL",
      errorMessage:
        "This hospital is set to register e-invoices manually. Generate the IRN on the " +
        "government portal, then record it against this bill.",
    };
  }

  async cancel(): Promise<IrpCancelResult> {
    return {
      ok: false,
      errorCode: "MANUAL",
      errorMessage:
        "Cancel the IRN on the government portal, then record the cancellation against this bill.",
    };
  }
}

/**
 * Resolve the configured provider.
 *
 * Deliberately falls back to manual on an unknown name rather than throwing.
 * A typo in a config row must not take the billing counter down; it should
 * degrade to "an accountant does this by hand", which still works.
 */
export function irpAdapterFor(provider: string): IrpAdapter {
  switch (provider.trim().toUpperCase()) {
    // Add a GSP here:
    //   case "CLEARTAX": return new ClearTaxAdapter(env);
    case "MANUAL":
    default:
      return new ManualIrpAdapter();
  }
}
