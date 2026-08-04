"use client";

/**
 * The catalogue, as a list you tick.
 *
 * Shared by the order screen and the billing screen so a test costs and reads
 * the same on both. The price shown is the catalogue price; what the patient
 * pays is snapshotted onto the order at the moment it is placed, which is why
 * this list is only ever an estimate until the bill exists.
 */

import { useState } from "react";
import { Icon } from "@/components/portal/ui/icons";

export interface CatalogItem {
  id: string; name: string; code: string | null; price: string; gstRatePct: string;
}

export function TestPicker({
  catalog,
  picked,
  onToggle,
  step = "2",
  title = "Select tests",
  hint,
  disabled = false,
  maxHeight = "420px",
}: {
  catalog: CatalogItem[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  step?: string;
  title?: string;
  hint?: string;
  disabled?: boolean;
  maxHeight?: string;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  // Codes are how a chit from an outside doctor writes a test - "CBC", "LFT" -
  // so they have to match as readily as the printed name does.
  const shown = q
    ? catalog.filter((c) => c.name.toLowerCase().includes(q) || (c.code ?? "").toLowerCase().includes(q))
    : catalog;

  return (
    <section data-rise className={`surface overflow-hidden ${disabled ? "pointer-events-none opacity-55" : ""}`}>
      <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{step} · {title}</h3>
          {hint && <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">{hint}</p>}
        </div>
        <span className="badge">{picked.size} selected</span>
      </div>
      <div className="p-6">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
          <Icon name="search" size={15} />
          <input
            value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or code…" className="w-full text-sm outline-none"
          />
          {filter && (
            <button onClick={() => setFilter("")} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]" aria-label="Clear filter">
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
        <div className="space-y-2 overflow-y-auto overscroll-contain pr-1" style={{ maxHeight }}>
          {shown.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--p-muted)]">No test matches “{filter}”.</p>
          ) : shown.map((c) => {
            const on = picked.has(c.id);
            return (
              <button
                key={c.id} onClick={() => onToggle(c.id)}
                className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                  on ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)]/40" : "border-[var(--p-border)] hover:border-[var(--p-teal)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    on ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)]"
                  }`}>
                    {on && <Icon name="check" size={12} />}
                  </span>
                  <div>
                    <div className="text-[13px] font-medium text-[var(--p-ink)]">{c.name}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">
                      {c.code && <span className="font-mono">{c.code}</span>}
                      {Number(c.gstRatePct) === 0 ? " · GST exempt" : ` · GST ${c.gstRatePct}%`}
                    </div>
                  </div>
                </div>
                <span className="font-mono text-[13px] font-semibold text-[var(--p-ink)]">₹{c.price}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
