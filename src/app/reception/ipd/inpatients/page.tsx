"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PrimaryButton, Pill } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

interface Inpatient {
  bedCharge: string; extrasCharge: string; extras: number;
  id: string; ipNumber: string; admittedAt: string; days: number;
  ward: string; bedNo: string; dailyCharge: string; runningCharge: string;
  reason: string | null; attendantName: string | null; attendantPhone: string | null;
  doctor: { name: string; department: string };
  patient: { displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
}
/** The full running bill for the discharge estimate - everything, not just the bed. */
interface DischSheet {
  days: number; bedTotal: string; nurseTotal: string; nursePerDay: string;
  chargesTotal: string; grandTotal: string; advanceTotal: string; balance: string;
  charges: { id: string; category: string; description: string; amount: string; fromPharmacy: boolean }[];
  /** Pharmacy and lab bills for this stay, still unpaid. NOT part of the
   *  discharge total below - they are separate invoices, settled on their own. */
  outstandingBills: { id: string; receiptNo: string; source: string; due: string }[];
  outstandingTotal: string;
}
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 });
const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const prettyDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
interface History {
  bills: { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string }[];
  labs: { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; forThisStay: boolean }[];
  prescriptions: { id: string; title: string | null; fileUrl: string | null; status: string; forThisStay: boolean; date: string; items: { medicineName: string; qty: number; dosage: string | null }[] }[];
}
type HistoryTarget = { id: string; ipNumber: string; patient: { displayId: string; fullName: string } };
interface Discharged {
  id: string; ipNumber: string; dischargedAt: string; days: number; ward: string; bedNo: string;
  patient: { id: string; displayId: string; fullName: string };
  doctor: { name: string; department: string };
  invoice: { id: string; receiptNo: string; totalAmount: string; status: string } | null;
}

export default function InpatientsPage() {
  const [rows, setRows] = useState<Inpatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dischargeOf, setDischargeOf] = useState<Inpatient | null>(null);
  const [sheet, setSheet] = useState<DischSheet | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);

  // patient history (billings / labs / prescriptions) for one stay
  const [historyOf, setHistoryOf] = useState<HistoryTarget | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyTab, setHistoryTab] = useState<"bills" | "labs" | "rx">("bills");
  function openHistory(r: HistoryTarget) {
    setHistoryOf(r); setHistory(null); setHistoryTab("bills");
    api.get<History>(`/ipd/admissions/${r.id}/history`).then(setHistory).catch(() => {});
  }

  const [discharges, setDischarges] = useState<Discharged[]>([]);
  const [disc, setDisc] = useState(0);
  const [payNow, setPayNow] = useState(true);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ipNumber: string; days: number; invoiceId: string; receiptNo: string; total: string } | null>(null);

  // Pull the FULL running bill (bed + nursing + every charge + advance) the
  // moment we open the discharge box, so the estimate matches the invoice the
  // backend actually raises - not just the bed.
  useEffect(() => {
    if (!dischargeOf) { setSheet(null); return; }
    let active = true; setSheetLoading(true); setSheet(null);
    api.get<DischSheet>(`/ipd/admissions/${dischargeOf.id}/sheet`)
      .then((s) => { if (active) setSheet(s); })
      .catch(() => { if (active) setSheet(null); })
      .finally(() => { if (active) setSheetLoading(false); });
    return () => { active = false; };
  }, [dischargeOf]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d] = await Promise.all([
        api.get<{ inpatients: Inpatient[] }>("/ipd/admissions"),
        api.get<{ discharges: Discharged[] }>("/ipd/discharges").catch(() => ({ discharges: [] as Discharged[] })),
      ]);
      setRows(r.inpatients); setDischarges(d.discharges);
    }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load inpatients."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // The whole bill, not just the bed. Discount comes off the grand total; the
  // advance already held is then credited, leaving what the family pays now.
  const grand = sheet ? Number(sheet.grandTotal) : 0;
  const advance = sheet ? Number(sheet.advanceTotal) : 0;
  const afterDiscount = Math.max(0, grand - disc);
  const est = Math.max(0, afterDiscount - advance);
  const refundDue = Math.max(0, advance - afterDiscount);

  async function discharge(allowOutstanding = false) {
    if (!dischargeOf) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ ipNumber: string; days: number; invoice: { id: string; receiptNo: string; totalAmount: string } }>(
        `/ipd/admissions/${dischargeOf.id}/discharge`,
        {
          discountAmount: disc || undefined,
          payments: payNow && payments.length ? payments : undefined,
          notes: notes || undefined,
          // Only ever sent from the explicit override below - never a default.
          ...(allowOutstanding ? { allowOutstanding: true } : {}),
        }
      );
      setDone({ ipNumber: res.ipNumber, days: res.days, invoiceId: res.invoice.id, receiptNo: res.invoice.receiptNo, total: res.invoice.totalAmount });
      await load();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not discharge."); }
    finally { setBusy(false); }
  }

  function closeModal() { setDischargeOf(null); setDisc(0); setPayments([]); setPayValid(true); setNotes(""); setPayNow(true); setDone(null); setError(null); }

  const Line = ({ k, v, tone, neg }: { k: string; v: string; tone?: "muted" | "cyan"; neg?: boolean }) => (
    <div className="mt-1 flex justify-between first:mt-0">
      <span className="text-[var(--p-muted)]">{k}</span>
      <span className={`font-mono tabular ${tone === "cyan" ? "font-semibold text-[var(--p-cyan-deep)]" : tone === "muted" ? "text-[var(--p-muted)]" : "text-[var(--p-ink)]"}`}>
        {neg ? "−" : ""}₹{money(v)}
      </span>
    </div>
  );

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Inpatients</h1>
          <p className="mt-1 text-[14px] text-[var(--p-muted)]">Everyone currently in a bed, with the stay charge running.</p>
        </div>
        <Link href="/ipd" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
          <Icon name="bed" size={15} /> Bed board
        </Link>
      </div>

      {error && !dischargeOf && <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{error}</div>}

      <section data-rise className="surface overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-[var(--p-muted)]">No one is admitted right now.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{r.patient.fullName}</span>
                    <span className="font-mono text-[12px] text-[var(--p-blue)]">{r.ipNumber}</span>
                    <Pill tone="checkedin">{r.ward} · {r.bedNo}</Pill>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--p-muted)]">
                    <span className="tabular">{r.patient.displayId}</span>
                    {r.patient.age != null && ` · ${r.patient.age}y`}
                    {" · "}{r.doctor.name}
                    {r.reason && ` · ${r.reason}`}
                  </div>
                  {r.attendantName && (
                    <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                      Attendant: {r.attendantName}{r.attendantPhone && ` · ${r.attendantPhone}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-mono text-[14px] font-semibold text-[var(--p-ink)] tabular">₹{r.runningCharge}</div>
                    <div className="text-[12px] text-[var(--p-muted)]">
                      bed ₹{r.bedCharge} ({r.days}d)
                      {r.extras > 0 && <> + {r.extras} charge{r.extras === 1 ? "" : "s"} ₹{r.extrasCharge}</>}
                    </div>
                  </div>
                  <button onClick={() => openHistory(r)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="activity" size={14} /> History
                  </button>
                  <a href={`/print/discharge/${r.id}`} target="_blank" rel="noopener noreferrer"
                    title="The running bill for this stay - bed, nursing, pharmacy and charges"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="receipt" size={14} /> Bill
                  </a>
                  <Link href={`/ipd/${r.id}`}
                    className="rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-blue)] hover:border-[var(--p-blue)]">
                    Open sheet
                  </Link>
                  <button onClick={() => setDischargeOf(r)}
                    className="btn-primary rounded-lg px-3.5 py-2 text-[13px] font-semibold text-white">
                    Discharge
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- RECENTLY DISCHARGED - re-print bills after the patient has left ---------- */}
      {discharges.length > 0 && (
        <section data-rise className="surface mt-6 overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-6 py-4">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Recently discharged</h3>
            <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">Re-print the bill or open the record after the patient has left the ward.</p>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {discharges.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--p-ink)]">{d.patient.fullName}</span>
                    <span className="font-mono text-[12px] text-[var(--p-blue)]">{d.ipNumber}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--p-muted)]">
                    <span className="tabular">{d.patient.displayId}</span> · {d.ward} · {d.days}d · {d.doctor.name} · discharged {prettyDateTime(d.dischargedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {d.invoice && (
                    <div className="text-right">
                      <div className="font-mono text-[13px] font-semibold text-[var(--p-ink)] tabular">₹{money(d.invoice.totalAmount)}</div>
                      <div className="font-mono text-[11px] text-[var(--p-muted)]">{d.invoice.receiptNo}</div>
                    </div>
                  )}
                  <button onClick={() => openHistory(d)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="activity" size={14} /> History
                  </button>
                  <a href={`/print/discharge/${d.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={14} /> Summary
                  </a>
                  {d.invoice ? (
                    <a href={`/print/invoice/${d.invoice.id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-blue)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="receipt" size={14} /> Print bill
                    </a>
                  ) : (
                    <span className="text-[12px] text-[var(--p-muted)]">No IPD invoice</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---------- DISCHARGE MODAL ---------- */}
      {dischargeOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="surface w-full max-w-md overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">Discharge {dischargeOf.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]"><span className="font-mono">{dischargeOf.ipNumber}</span> · {dischargeOf.ward} · {dischargeOf.bedNo}</p>
              </div>
              <button onClick={closeModal} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            {done ? (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name="check" size={26} /></span>
                <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Discharged</h3>
                <p className="mt-1 text-[14px] text-[var(--p-muted)]">
                  {done.days} day{done.days > 1 ? "s" : ""} · Receipt <span className="font-mono font-semibold text-[var(--p-ink)]">{done.receiptNo}</span> · ₹{done.total}
                </p>
                <p className="mt-1 text-[13px] text-[var(--p-muted)]">The bed is free again on the board.</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  {done.invoiceId && (
                    <a href={`/print/invoice/${done.invoiceId}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
                      <Icon name="receipt" size={15} /> Print bill
                    </a>
                  )}
                  <a href={`/print/discharge/${dischargeOf.id}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                    <Icon name="file" size={15} /> Discharge summary
                  </a>
                  <button onClick={closeModal} className="rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)]">Done</button>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-4 p-6">
                  <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4 text-[14px]">
                    {sheetLoading || !sheet ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Totting up the full bill…</div>
                    ) : (
                      <>
                        <Line k={`Bed · ${sheet.days} day${sheet.days > 1 ? "s" : ""}`} v={sheet.bedTotal} />
                        <Line k={`Nursing · ${sheet.days}d × ₹${money(sheet.nursePerDay)}`} v={sheet.nurseTotal} />
                        {Number(sheet.chargesTotal) > 0 && <Line k={`Charges & pharmacy (${sheet.charges.length})`} v={sheet.chargesTotal} />}
                        <div className="mt-2 flex justify-between border-t border-[var(--p-border)] pt-2">
                          <span className="font-semibold text-[var(--p-ink)]">Grand total</span>
                          <span className="font-mono text-[15px] font-semibold text-[var(--p-ink)] tabular">₹{money(sheet.grandTotal)}</span>
                        </div>
                        {disc > 0 && <Line k="Discount" v={disc.toFixed(2)} neg tone="muted" />}
                        {advance > 0 && <Line k="Advance already paid" v={sheet.advanceTotal} neg tone="cyan" />}
                        <div className="mt-2 flex justify-between border-t border-[var(--p-border)] pt-2">
                          <span className="font-semibold text-[var(--p-ink)]">{refundDue > 0 ? "Refund due" : "To collect now"}</span>
                          <span className="font-mono text-[16px] font-bold text-[var(--p-blue)] tabular">₹{(refundDue > 0 ? refundDue : est).toFixed(2)}</span>
                        </div>
                        {refundDue > 0 && <p className="mt-2 text-[12px] text-[#8a6414]">The advance exceeds the bill - ₹{refundDue.toFixed(2)} must be refunded, not kept.</p>}
                        <p className="mt-2 text-[12px] leading-relaxed text-[var(--p-muted)]">
                          This invoice covers the STAY - bed, nursing and procedures. Pharmacy and
                          lab are billed separately and are listed below if anything is unpaid.
                        </p>

                        {/* THE THREE BILLS ARE SEPARATE. This total is the stay
                            only, so the pharmacy and lab money has to be shown
                            here or the desk would collect the bed and let the
                            family walk out owing the rest. */}
                        {sheet.outstandingBills?.length > 0 && (
                          <div className="mt-3 rounded-lg border border-[var(--p-amber)]/40 bg-[var(--p-amber-soft)] px-3 py-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-bold uppercase tracking-wide text-[#8a6414]">Still to collect separately</span>
                              <span className="font-mono text-[14px] font-bold text-[#8a6414]">₹{money(sheet.outstandingTotal)}</span>
                            </div>
                            <div className="mt-1.5 space-y-1">
                              {sheet.outstandingBills.map((b) => (
                                <div key={b.id} className="flex items-center justify-between gap-2 text-[12px] text-[#8a6414]">
                                  <span className="truncate">{SRC_LABEL[b.source] ?? b.source} · <span className="font-mono">{b.receiptNo}</span></span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <span className="font-mono font-semibold">₹{money(b.due)}</span>
                                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer"
                                      className="font-semibold text-[var(--p-teal)] hover:underline">Bill</a>
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="mt-1.5 text-[11px] leading-relaxed text-[#8a6414]">
                              Settle these at their own counters. Discharge is refused while they are outstanding.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <DiscountInput subtotal={grand} accent="blue" onChange={(d) => setDisc(d.amount)} />

                  <label className="flex items-center gap-2 text-[14px] text-[var(--p-text)]">
                    <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-[var(--p-blue)]" /> Collect payment now
                  </label>
                  {payNow && est > 0 && (
                    <PaymentSection total={est} accent="blue" onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }} />
                  )}

                  <Field label="Discharge notes"><textarea className={`${fld} min-h-[56px] resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Condition on discharge, advice…" /></Field>
                </div>

                {error && <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-6 py-2.5 text-[13px] text-[var(--p-rose)]">{error}</div>}

                <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
                  <button onClick={closeModal} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
                  {/* The override is a separate, plainly-worded button rather
                      than a checkbox on the main one - discharging someone who
                      still owes money should take a deliberate second act, and
                      it is recorded against the name that pressed it. */}
                  {(sheet?.outstandingBills?.length ?? 0) > 0 && (
                    <button onClick={() => discharge(true)} disabled={busy || !sheet}
                      className="rounded-lg border border-[var(--p-amber)] px-4 py-2 text-sm font-semibold text-[#8a6414] hover:bg-[var(--p-amber-soft)] disabled:opacity-40">
                      Discharge leaving ₹{money(sheet!.outstandingTotal)} unpaid
                    </button>
                  )}
                  <PrimaryButton onClick={() => discharge(false)} disabled={busy || !sheet || (payNow && est > 0 && !payValid)}>
                    {busy ? <><Spinner /> Discharging…</> : <><Icon name="check" size={15} /> Discharge &amp; bill</>}
                  </PrimaryButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- HISTORY MODAL ---------- */}
      {historyOf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setHistoryOf(null)}>
          <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <div>
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">History · {historyOf.patient.fullName}</h3>
                <p className="text-[13px] text-[var(--p-muted)]"><span className="font-mono">{historyOf.patient.displayId}</span> · {historyOf.ipNumber}</p>
              </div>
              <button onClick={() => setHistoryOf(null)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>
            <div className="flex gap-1 border-b border-[var(--p-border)] px-3 py-2">
              {([["bills", "Billings", history?.bills.length], ["labs", "Lab reports", history?.labs.length], ["rx", "Prescriptions", history?.prescriptions.length]] as const).map(([k, label, n]) => (
                <button key={k} onClick={() => setHistoryTab(k)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${historyTab === k ? "bg-[var(--p-blue)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)]"}`}>
                  {label}{n != null && n > 0 && <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${historyTab === k ? "bg-white/25" : "bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"}`}>{n}</span>}
                </button>
              ))}
            </div>
            <div className="flex-1 divide-y divide-[var(--p-border)] overflow-y-auto">
              {!history ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--p-muted)]"><Spinner size={14} /> Loading history…</div>
              ) : historyTab === "bills" ? (
                history.bills.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No bills yet.</p> : history.bills.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-[var(--p-ink)]"><span className="font-mono">{b.receiptNo}</span> · {SRC_LABEL[b.source] ?? b.source}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(b.date)} · Paid ₹{money(b.paid)} of ₹{money(b.total)}{Number(b.balance) > 0 && <span className="text-[var(--p-rose)]"> · ₹{money(b.balance)} due</span>}</div>
                    </div>
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="receipt" size={13} /> Invoice</a>
                  </div>
                ))
              ) : historyTab === "labs" ? (
                history.labs.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No lab tests yet.</p> : history.labs.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{l.testName}</span>{l.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(l.date)} · {l.status === "COMPLETED" ? "Completed" : "Pending"}</div>
                    </div>
                    {l.reportUrl ? <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"><Icon name="file" size={13} /> Report</a> : <span className="shrink-0 text-[11.5px] text-[var(--p-muted)]">No report yet</span>}
                  </div>
                ))
              ) : (
                history.prescriptions.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">No prescriptions yet.</p> : history.prescriptions.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="truncate text-[13.5px] font-medium text-[var(--p-ink)]">{r.title || (r.items.length ? r.items.map((i) => i.medicineName).slice(0, 2).join(", ") + (r.items.length > 2 ? "…" : "") : "Prescription")}</span>{r.forThisStay && <span className="shrink-0 rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--p-blue-deep)]">This stay</span>}</div>
                      <div className="text-[12px] text-[var(--p-muted)]">{prettyDate(r.date)} · {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.status.toLowerCase().replace(/_/g, " ")}</div>
                    </div>
                    {r.fileUrl && <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-blue)] hover:border-[var(--p-blue)]"><Icon name="file" size={13} /> Scan</a>}
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end border-t border-[var(--p-border)] p-4">
              <button onClick={() => setHistoryOf(null)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Close</button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
