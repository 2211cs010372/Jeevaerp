"use client";

import { useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * THE INSURER SAID NO, SO THE STAY BECOMES THE FAMILY'S.
 *
 * This is the moment a cashless admission turns into a bill somebody has to be
 * asked for, and it is the worst conversation the desk has. Everything here is
 * shaped around making it survivable:
 *
 *   THE REASON IS MANDATORY. A family told for four days that their treatment
 *   was cashless is about to be handed the whole bill, and "the insurer refused,
 *   ref XYZ" is the only thing that makes that conversation possible. It is
 *   written onto the stay's own chronology, not just the audit log, so the ward
 *   can read it back weeks later when the query comes.
 *
 *   IT SAYS WHAT IT WILL DO BEFORE IT DOES IT. Three separate things change -
 *   the bills, the stay's payer, and any amount the insurer had approved - and
 *   a desk that presses this without knowing the third one will under-collect.
 *
 *   BILLS THE INSURER ALREADY PAID ARE LEFT ALONE. The server skips any invoice
 *   with money against it and says which; asking a family for something already
 *   settled is how a refusal becomes a complaint.
 *
 * Reversing it is not a button. If the insurer changes their mind the desk
 * raises a fresh claim - which is what actually happens, because the second
 * decision comes with its own reference number.
 */
export function ConvertToSelfPayDialog({
  admissionId, ipNumber, insurer, onClose, onDone,
}: {
  admissionId: string;
  ipNumber: string;
  /** Named so the note and this dialog both say who refused. */
  insurer: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = reason.trim().length >= 3;

  async function convert() {
    if (!ready) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{
        moved: { receiptNo: string }[]; movedTotal: string;
        skipped: { receiptNo: string; why: string }[]; stayConverted: boolean;
      }>(`/insurance/admissions/${admissionId}/claims`, {
        reason: reason.trim(),
        convertStay: true,
      });
      onDone(
        `${ipNumber} is now self-paying. ₹${Number(r.movedTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })} across ` +
        `${r.moved.length} bill${r.moved.length === 1 ? "" : "s"} is the patient's — collect it on Billing.` +
        (r.skipped.length ? ` ${r.skipped.length} bill(s) left alone: money was already taken against them.` : "")
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't convert the stay.");
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface w-full max-w-lg bg-white">
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Insurance rejected — convert to self-pay cash</h3>
            <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">
              {ipNumber}{insurer ? ` · ${insurer}` : ""} — convert this stay to self-pay
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
        </div>

        <div className="space-y-4 p-6">
          {/* Said before the button, not after. */}
          <div className="rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8a6414]">
            <b className="uppercase">This changes four things.</b>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>Every unpaid insurance bill on this stay becomes the <b>patient&apos;s</b>.</li>
              <li>The stay itself becomes <b>self-pay</b> — it leaves the claims list, and new bills go to the family.</li>
              <li>Any amount the insurer had <b>approved is cleared</b>, so the family is billed the full total rather than a co-pay.</li>
              <li>The stay&apos;s <b>claim is marked rejected</b> with this reason — so the claims board and the ward stop disagreeing about who is paying.</li>
            </ul>
            <p className="mt-2">
              Bills the insurer has already paid are left alone.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
              Why<Req />
            </label>
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Refused — pre-existing condition, TPA ref CLM/2026/8841"
              className="w-full rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13.5px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
              Goes onto the stay&apos;s record where the ward and the desk can both read it.
              The family will ask why they are being billed for a stay they were told was cashless.
            </p>
          </div>

          {err && (
            <div className="rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--p-rose)]">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[var(--p-border)] px-6 py-4">
          <button onClick={onClose} className="text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">
            Cancel
          </button>
          <button onClick={convert} disabled={!ready || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
            {busy ? <><Spinner size={14} /> Converting…</> : <><Icon name="rupee" size={14} /> Convert to self-pay</>}
          </button>
        </div>
      </div>
    </div>
  );
}
