"use client";

/**
 * "THIS BILL WAS ALREADY GENERATED" - one dialog for every place a regenerated
 * bill gets caught.
 *
 * The server refuses the same items for the same patient within a few minutes
 * - the same lab order, the same pharmacy basket or chit, the same stay line,
 * the same desk bill (lib/repeat-guard). Every screen that raises one shows the
 * refusal here, so the desk reads the same words wherever it is standing.
 *
 * The first answer is the bill that already exists: print it. Not generating
 * again is the default button. Going ahead is still possible - a real repeat
 * is the owner's call, not ours - but it is a deliberate second click.
 */

import { useEffect } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import type { RepeatBlock, RepeatKind } from "@/lib/repeat-guard";

const COPY: Record<RepeatKind, { title: string; lead: string; go: string; keep: string }> = {
  LAB_TEST: {
    title: "These tests were just ordered",
    lead: "The same tests were ordered for this patient a few minutes ago. If the first order went through, ordering again makes a second bill for the same sample.",
    go: "It's a new order - order again",
    keep: "Don't order again",
  },
  DISPENSE: {
    title: "This bill was already generated",
    lead: "These medicines are already billed to this patient. Generating again charges them twice and takes the stock twice.",
    go: "It's a new sale - dispense again",
    keep: "Don't dispense again",
  },
  STAY_CHARGE: {
    title: "This charge was just added",
    lead: "The same line went on this stay a few minutes ago. Adding it again bills it twice on the detailed bill.",
    go: "It's a new charge - add again",
    keep: "Don't add again",
  },
  CONSULTATION: {
    title: "This bill was already generated",
    lead: "The same bill was raised for this patient a few minutes ago. Generating again charges them twice.",
    go: "It's a new bill - generate again",
    keep: "Don't generate again",
  },
};

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export function RepeatConfirmDialog({
  block, message, busy = false, onConfirm, onClose,
}: {
  block: RepeatBlock;
  /** The server's own sentence - names the bill and how long ago. */
  message?: string;
  busy?: boolean;
  /** Go ahead anyway: the caller resubmits with `confirmRepeat`. */
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = COPY[block.kind];

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, onClose]);

  return (
    <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="repeat-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="surface flex max-h-[90vh] w-full max-w-md flex-col bg-white">
        <div className="shrink-0 border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-4">
          <h3 id="repeat-title" className="flex items-center gap-2 text-[15px] font-semibold text-[#8a6414]">
            <Icon name="alert" size={16} /> {copy.title}
          </h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--p-text)]">{message ?? copy.lead}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {block.items.map((it, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-[var(--p-ink)]">{it.label}</span>
                <span className="block text-[12px] text-[var(--p-muted)]">
                  {time(it.at)}{it.detail && ` · ${it.detail}`}
                </span>
              </span>
              {/* The bill that already exists, as the proper sheet - never
                  this screen. Printing it is usually the whole answer. */}
              {it.invoiceId && (
                <a href={`/print/invoice/${it.invoiceId}?print=1`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-teal)]/50 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--p-teal)] hover:bg-[var(--p-teal-soft)]">
                  <Icon name="printer" size={13} /> Print that bill
                </a>
              )}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
          <button type="button" onClick={onConfirm} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-amber)]/60 bg-white px-4 py-2 text-[13px] font-semibold text-[#8a6414] transition-colors hover:bg-[var(--p-amber-soft)] disabled:opacity-40">
            {busy ? <><Spinner /> Working…</> : copy.go}
          </button>
          <button type="button" onClick={onClose} disabled={busy} autoFocus
            className="rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] disabled:opacity-45">
            {copy.keep}
          </button>
        </div>
      </div>
    </div>
  );
}
