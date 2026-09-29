"use client";

/**
 * The on-screen confirmation of a lab bill, shown the moment it is raised.
 *
 * Lifted out of the billing screen so the order screen can show the SAME
 * document when it bills in one action. Two renderings of one receipt is how a
 * hospital ends up with two receipts that disagree - one carrying the GST note,
 * one not - and the disagreement is only ever discovered by an auditor.
 *
 * It is NOT what gets printed. "Print bill" opens /print/invoice/<id>, the one
 * shared sheet every counter prints from - see components/print/invoice-sheet.
 */

import { useEffect } from "react";
import { Icon } from "@/components/portal/ui/icons";

export interface LabInvoice {
  id: string; receiptNo: string; source: string; status: string; createdAt: string;
  patient: { displayId: string; fullName: string; phone: string; address: string | null };
  items: { description: string; hsnSac: string | null; qty: number; unitPrice: string; amount: string; gstRatePct: string }[];
  subtotal: string; discountAmount: string; taxableAmount: string;
  cgstAmount: string; sgstAmount: string; totalAmount: string; amountPaid: string; balanceDue: string;
  hospital: {
    legalName: string; addressLine: string; city: string; state: string;
    stateCode: string; pincode: string; gstin: string | null; phone: string | null;
  } | null;
}

export function InvoiceView({
  invoice,
  onNew,
  newLabel = "New bill",
  banner,
}: {
  invoice: LabInvoice;
  onNew: () => void;
  newLabel?: string;
  /** Anything the screen wants said above the receipt - a new Jeeva ID, say. */
  banner?: React.ReactNode;
}) {
  const h = invoice.hospital;
  const exempt = Number(invoice.cgstAmount) === 0 && Number(invoice.sgstAmount) === 0;
  // The bill sheet, told to open the print dialog as soon as it has loaded.
  const printHref = `/print/invoice/${invoice.id}?print=1`;

  // CTRL+P ON THIS SCREEN PRINTS THE BILL, NOT THE SCREEN. A desk that has
  // printed with the keyboard for years will keep doing it, and the browser's
  // own print of this page is the portal's top bar and a screen card - the
  // sheet a patient was being handed until 29 Sep 2026. A keypress is a user
  // gesture, so the new tab is not caught by the popup blocker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.open(printHref, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [printHref]);
  const discPctNum = Number(invoice.subtotal) > 0 ? (Number(invoice.discountAmount) / Number(invoice.subtotal)) * 100 : 0;
  const discPct = discPctNum % 1 === 0 ? discPctNum.toFixed(0) : discPctNum.toFixed(1);

  return (
    <div className="mx-auto max-w-3xl">
      {banner && <div className="mb-4 print:hidden">{banner}</div>}

      <div className="mb-4 flex justify-between print:hidden">
        <button onClick={onNew} className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)]">
          <Icon name="plus" size={14} /> {newLabel}
        </button>
        {/* THE PRINTED BILL IS THE HOSPITAL'S SHEET, NOT THIS SCREEN.
            This used to call window.print() on the portal page, so the desk
            printed the sidebar, the header and a screen-styled card instead of
            the bill every other counter hands over. It now opens the same
            Bill-of-Supply sheet (InvoiceSheet) as reception's other bills. */}
        <a href={printHref} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--p-teal-deep)]">
          <Icon name="printer" size={14} /> Print bill
        </a>
      </div>

      <div className="surface overflow-hidden bg-white">
        {/* header */}
        <div className="border-b border-[var(--p-border)] px-8 py-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-serif-p text-[20px] font-semibold text-[var(--p-ink)]">{h?.legalName ?? "Jeeva Multispeciality Hospital"}</h2>
              {h && <p className="mt-1 text-[12px] leading-relaxed text-[var(--p-muted)]">{h.addressLine}<br />{h.city}, {h.state} – {h.pincode}{h.phone && <> · {h.phone}</>}</p>}
              {h?.gstin && <p className="mt-1 font-mono text-[12px] text-[var(--p-ink)]">GSTIN: {h.gstin} · State code: {h.stateCode}</p>}
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--p-muted)]">Tax Invoice</p>
              <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--p-ink)]">{invoice.receiptNo}</p>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">{new Date(invoice.createdAt).toLocaleString("en-IN")}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${invoice.status === "PAID" ? "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]" : "bg-[var(--p-amber-soft)] text-[#8a6414]"}`}>{invoice.status}</span>
            </div>
          </div>
        </div>

        {/* patient */}
        <div className="grid grid-cols-2 gap-px border-b border-[var(--p-border)] bg-[var(--p-border)]">
          <div className="bg-white px-8 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed to</p>
            <p className="mt-1 text-[14px] font-medium text-[var(--p-ink)]">{invoice.patient.fullName}</p>
            <p className="font-mono text-[12px] text-[var(--p-muted)]">{invoice.patient.displayId} · {invoice.patient.phone}</p>
          </div>
          <div className="bg-white px-8 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Place of supply</p>
            <p className="mt-1 text-[14px] text-[var(--p-ink)]">{h?.state ?? "Telangana"} ({h?.stateCode ?? "36"})</p>
          </div>
        </div>

        {/* items */}
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--p-border)] bg-[var(--p-bg)] text-[11px] uppercase tracking-wide text-[var(--p-muted)]">
              <th className="px-8 py-2.5 font-semibold">Description</th>
              <th className="py-2.5 font-semibold">SAC</th>
              <th className="py-2.5 text-center font-semibold">Qty</th>
              <th className="py-2.5 text-right font-semibold">Rate</th>
              <th className="py-2.5 text-center font-semibold">GST</th>
              <th className="px-8 py-2.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--p-border)]">
            {invoice.items.map((it, i) => (
              <tr key={i}>
                <td className="px-8 py-3 text-[var(--p-ink)]">{it.description}</td>
                <td className="py-3 font-mono text-[12px] text-[var(--p-muted)]">{it.hsnSac ?? "-"}</td>
                <td className="py-3 text-center">{it.qty}</td>
                <td className="py-3 text-right font-mono">₹{it.unitPrice}</td>
                <td className="py-3 text-center font-mono text-[12px]">{Number(it.gstRatePct) === 0 ? "Exempt" : `${it.gstRatePct}%`}</td>
                <td className="px-8 py-3 text-right font-mono font-semibold">₹{it.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* totals */}
        <div className="flex justify-end border-t border-[var(--p-border)] bg-[var(--p-bg)] px-8 py-5">
          <div className="w-64 space-y-2 text-[13px]">
            <T k="Subtotal" v={invoice.subtotal} />
            {Number(invoice.discountAmount) > 0 && <T k={`Discount (${discPct}%)`} v={`-${invoice.discountAmount}`} />}
            <T k="Taxable value" v={invoice.taxableAmount} />
            <T k="CGST" v={invoice.cgstAmount} />
            <T k="SGST" v={invoice.sgstAmount} />
            {/* Bills are whole rupees (lib/money-round) - the same line the printed sheet carries. */}
            {(() => {
              const ro = Math.round((Number(invoice.totalAmount) - Number(invoice.taxableAmount) - Number(invoice.cgstAmount) - Number(invoice.sgstAmount)) * 100) / 100;
              return Math.abs(ro) >= 0.01 ? (
                <div className="flex justify-between"><span className="text-[var(--p-muted)]">Round off</span><span className="font-mono text-[var(--p-ink)]">{ro < 0 ? "−" : ""}₹{Math.abs(ro).toFixed(2)}</span></div>
              ) : null;
            })()}
            <div className="rule" />
            <div className="flex justify-between pt-1">
              <span className="text-[14px] font-semibold text-[var(--p-ink)]">Total</span>
              <span className="font-mono text-[16px] font-semibold text-[var(--p-teal)]">₹{invoice.totalAmount}</span>
            </div>
            {Number(invoice.amountPaid) > 0 && <T k="Paid" v={invoice.amountPaid} />}
            {Number(invoice.balanceDue) > 0 && <T k="Balance due" v={invoice.balanceDue} />}
          </div>
        </div>

        {exempt && (
          <p className="border-t border-[var(--p-border)] px-8 py-3 text-[11px] leading-relaxed text-[var(--p-muted)]">
            Healthcare services by a clinical establishment are exempt from GST under Notification 12/2017 – Central Tax (Rate). Rates are configurable per test.
          </p>
        )}
      </div>
    </div>
  );
}

function T({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-[var(--p-muted)]">{k}</span><span className="font-mono text-[var(--p-ink)]">₹{v.replace("-", "")}</span></div>;
}
