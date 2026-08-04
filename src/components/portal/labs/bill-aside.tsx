"use client";

/**
 * The money column - what is being charged, less any discount, and how it is
 * being settled.
 *
 * One component for the order screen and the billing screen because they are
 * now the same act seen at two moments: the order screen bills a walk-in as the
 * tests are placed, the billing screen bills tests placed earlier. A discount
 * entered on one has to mean exactly what it means on the other.
 *
 * GST is NOT computed here. It comes back from the server at each test's
 * catalogue rate, and a number invented on screen that disagreed with the
 * receipt would be worse than no number at all - so the totals shown are
 * labelled as an estimate up to the taxable value, and stop there.
 */

import { useEffect, useRef, useState } from "react";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";

export interface BillLine { id: string; label: string; amount: number; note?: string }

export interface Settlement {
  discountAmount: number;
  /** Empty when the desk isn't taking money now - the bill is raised unpaid. */
  payments: Tender[];
  /** False while a split doesn't add up - the submit button stays disabled. */
  valid: boolean;
}

export function BillAside({
  title = "Bill",
  lines,
  emptyText = "No tests selected.",
  billNow,
  onBillNowChange,
  billNowLabel = "Bill and collect now",
  onSettlementChange,
  error,
  footnote,
  action,
}: {
  title?: string;
  lines: BillLine[];
  emptyText?: string;
  /**
   * Whether a bill is being raised at all. Pass `null` on a screen where
   * billing is the whole point - the toggle then isn't rendered.
   */
  billNow: boolean | null;
  onBillNowChange?: (v: boolean) => void;
  billNowLabel?: string;
  onSettlementChange: (s: Settlement) => void;
  error?: string | null;
  footnote?: React.ReactNode;
  /** The submit button. Owned by the screen, because only it knows the verb. */
  action: React.ReactNode;
}) {
  const [discount, setDiscount] = useState(0);
  const [payNow, setPayNow] = useState(true);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxable = Math.max(0, subtotal - discount);
  const billing = billNow !== false;

  // ONE place decides what the screen is settling for. The discount control and
  // the payment control each know only their own field, and an earlier version
  // that let both write the whole settlement could publish "no tenders, valid"
  // for a render after the discount moved - i.e. a paid bill briefly looking
  // like an unpaid one. They now feed state, and this derives the answer.
  const cb = useRef(onSettlementChange);
  cb.current = onSettlementChange;
  useEffect(() => {
    const taking = billing && payNow;
    cb.current({
      discountAmount: billing ? discount : 0,
      payments: taking ? payments : [],
      valid: taking ? payValid : true,
    });
  }, [billing, payNow, discount, payments, payValid]);

  return (
    <div className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--p-ink)]">{title}</p>
      </div>

      <div className="max-h-64 divide-y divide-[var(--p-border)] overflow-y-auto">
        {lines.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12px] text-[var(--p-muted)]">{emptyText}</p>
        ) : lines.map((l) => (
          <div key={l.id} className="flex items-start justify-between gap-3 px-5 py-3">
            <span className="text-[12px] text-[var(--p-text)]">
              {l.label}
              {l.note && <span className="block text-[11px] text-[var(--p-muted)]">{l.note}</span>}
            </span>
            <span className="shrink-0 font-mono text-[12px] text-[var(--p-ink)]">₹{l.amount.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="space-y-3 border-t border-[var(--p-border)] p-5">
        <Row k="Subtotal" v={`₹${subtotal.toFixed(2)}`} />
        {billing && (
          <>
            <DiscountInput subtotal={subtotal} accent="teal" onChange={(d) => setDiscount(d.amount)} />
            <div className="rule my-1" />
            <Row k="Taxable" v={`₹${taxable.toFixed(2)}`} />
          </>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--p-muted)]">
          CGST + SGST are computed server-side from each test&apos;s catalogue rate (0% = exempt).
        </p>
      </div>

      {billNow !== null && (
        <label className="flex items-center gap-2 border-t border-[var(--p-border)] px-5 py-3.5 text-[13px] text-[var(--p-text)]">
          <input
            type="checkbox" checked={billNow}
            onChange={(e) => onBillNowChange?.(e.target.checked)}
            className="h-4 w-4 accent-[var(--p-teal)]"
          />
          {billNowLabel}
        </label>
      )}

      {billing && (
        <div className="border-t border-[var(--p-border)] p-5">
          <label className="mb-3 flex items-center gap-2 text-[13px] text-[var(--p-text)]">
            <input
              type="checkbox" checked={payNow}
              onChange={(e) => setPayNow(e.target.checked)}
              className="h-4 w-4 accent-[var(--p-teal)]"
            />
            Collect payment now
          </label>
          {payNow ? (
            <PaymentSection
              total={taxable}
              accent="teal"
              onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }}
            />
          ) : (
            <p className="text-[12px] leading-relaxed text-[var(--p-muted)]">
              The bill is raised <strong>unpaid</strong> and shows on the invoices list until it is settled.
            </p>
          )}
        </div>
      )}

      {error && <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-3 text-[12px] leading-relaxed text-[var(--p-rose)]">{error}</div>}

      <div className="border-t border-[var(--p-border)] p-5">
        {action}
        {footnote && <div className="mt-3 text-center text-[11px] leading-relaxed text-[var(--p-muted)]">{footnote}</div>}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between text-[13px]"><span className="text-[var(--p-muted)]">{k}</span><span className="font-mono text-[var(--p-ink)]">{v}</span></div>;
}
