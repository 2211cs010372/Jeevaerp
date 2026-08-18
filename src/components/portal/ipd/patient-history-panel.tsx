"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api } from "@/lib/api-client";

/**
 * EVERY BILL, LAB AND PRESCRIPTION THIS PATIENT HAS - not just this stay's.
 *
 * SHARED BY RECEPTION AND THE INSURANCE DESK, which is the whole reason it is a
 * component rather than a block on one page. Both desks answer the same question
 * off the same record - "what else has this patient had, and was it billed?" -
 * and while this lived only on the reception page the claims desk worked a stay
 * with no history in front of it at all. Two copies of ninety lines of JSX would
 * have drifted the first time either desk asked for a column.
 *
 * `reloadToken` is how a parent says "I changed something, read it again"
 * without this exposing a ref: bump the number and it refetches.
 */

interface History {
  bills: { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string; payer: string }[];
  labs: { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; forThisStay: boolean }[];
  prescriptions: { id: string; title: string | null; fileUrl: string | null; status: string; forThisStay: boolean; date: string; items: { medicineName: string; qty: number; dosage: string | null }[] }[];
}

const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });

export function PatientHistoryPanel({
  admissionId, canEdit, onEditBill, reloadToken = 0,
}: {
  admissionId: string;
  /** Whether bill correction is switched on for this portal. */
  canEdit: boolean;
  /** Opens the caller's EditBillDialog. Never called for an IPD bill - see below. */
  onEditBill: (invoiceId: string) => void;
  reloadToken?: number;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<"bills" | "labs" | "rx">("bills");

  const loadHistory = useCallback(() => {
    api.get<History>(`/ipd/admissions/${admissionId}/history`).then(setHistory).catch(() => {});
  }, [admissionId]);
  useEffect(() => { loadHistory(); }, [loadHistory, reloadToken]);

  return (
    <section data-rise className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-5 py-3.5">
        <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Patient history</h3>
        <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">Billings, lab reports and pharmacy across every visit. Rows from this stay are marked.</p>
      </div>
      <div className="flex gap-1 border-b border-[var(--p-border)] px-3 py-2">
        {([["bills", "Billings", history?.bills.length], ["labs", "Lab reports", history?.labs.length], ["rx", "Prescriptions", history?.prescriptions.length]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${tab === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)]"}`}>
            {label}{n != null && n > 0 && <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${tab === k ? "bg-white/25" : "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"}`}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="divide-y divide-[var(--p-border)]">
        {!history ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Loading history…</div>
        ) : tab === "bills" ? (
          history.bills.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No bills yet.</p> : history.bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]"><span className="font-mono">{b.receiptNo}</span> · {SRC_LABEL[b.source] ?? b.source}</div>
                {/* An unpaid balance on a cashless bill is with the insurer,
                    not with the family. In the same red as a real debt it
                    sends the desk to chase somebody who owes nothing. */}
                <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(b.date)} · Paid ₹{money(b.paid)} of ₹{money(b.total)}{Number(b.balance) > 0 && (
                  b.payer === "INSURANCE"
                    ? <span className="text-[var(--p-blue-deep)]"> · ₹{money(b.balance)} with insurer</span>
                    : <span className="text-[var(--p-rose)]"> · ₹{money(b.balance)} due</span>
                )}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" title="View & print this bill" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="receipt" size={13} /> View</a>
                {/* Every bill this patient has, not only this stay's - which
                    is why a cancelled one has to be excluded here and not
                    anywhere above: this list is the only one that shows
                    them. */}
                {/* AN INPATIENT BILL IS NOT EDITED HERE, and that is the
                    whole of how the stay and its bill stay in step.
                    The IPD invoice is DERIVED: reissueIpdInvoice rebuilds it
                    from the stay's dates, bed rate, nursing rate and tab
                    every time any of those is corrected. Editing the invoice
                    directly therefore produced a number that survived until
                    the next correction and was then silently overwritten -
                    two documents disagreeing about one stay, with nothing on
                    any screen to say which was right.
                    So the edit is offered where the source of truth is: the
                    stay sheet above. Every other counter's bill IS its own
                    source and stays editable here. */}
                {canEdit && b.status !== "CANCELLED" && (
                  b.source === "IPD" ? (
                    <span
                      title="An inpatient bill is built from its stay. Correct the stay's dates, bed rate, nursing rate or charges above and this bill re-issues itself."
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-muted)]">
                      <Icon name="bed" size={13} /> From the stay
                    </span>
                  ) : (
                    <button onClick={() => onEditBill(b.id)}
                      title={Number(b.paid) > 0
                        ? `Correct this bill — ₹${money(b.paid)} already collected`
                        : "Correct this bill's date, lines or amount"}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                      <Icon name="file" size={13} /> Edit
                    </button>
                  )
                )}
              </div>
            </div>
          ))
        ) : tab === "labs" ? (
          history.labs.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No lab tests yet.</p> : history.labs.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{l.testName}</span>{l.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(l.date)} · {l.status === "COMPLETED" ? "Completed" : "Pending"}</div>
              </div>
              {l.reportUrl ? <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Report</a> : <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">No report yet</span>}
            </div>
          ))
        ) : (
          history.prescriptions.length === 0 ? <p className="px-5 py-8 text-center text-[13px] text-[var(--p-muted)]">No prescriptions yet.</p> : history.prescriptions.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{r.title || (r.items.length ? r.items.map((i) => i.medicineName).slice(0, 2).join(", ") + (r.items.length > 2 ? "…" : "") : "Prescription")}</span>{r.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(r.date)} · {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.status.toLowerCase().replace(/_/g, " ")}</div>
              </div>
              {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="file" size={13} /> Scan</a>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
