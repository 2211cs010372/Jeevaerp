"use client";

/**
 * ADD A FORGOTTEN BILL - a new LAB or PHARMACY invoice on a stay, for something
 * the patient was given in the bed and nobody billed.
 *
 * The counters only bill a stay while it is ADMITTED, so after discharge there
 * was no way to raise a pharmacy or lab bill on it - only a line on the IPD
 * bill. This raises a proper counter bill (its own receipt number) on the stay,
 * and it prints and totals like any other: see addForgottenBill.
 *
 * Pharmacy asks one question every time, because only the desk knows the
 * answer: did these medicines come off the shelf without the system knowing
 * ("Take from stock" - stock goes down, oldest batch first), or is the stock
 * already right and only the bill is missing ("Just bill")?
 *
 * The bill is DATED IN THE STAY - the discharge day unless the desk picks
 * another day between admission and discharge - and is PAID by default: the
 * payment section opens ticked at the full amount. That payment is recorded
 * now, so it counts in today's day close under whoever raises the bill.
 *
 * Totals are worked out with the same function the server uses
 * (computeInvoiceTotals), so what the payment section asks for is what the
 * bill comes to.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { api, ApiClientError } from "@/lib/api-client";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";
import { computeInvoiceTotals, type CalcLine } from "@/server/billing/calc";

interface Med { id: string; name: string; unit: string; inStock: number; unitMrp: string | null; gstRatePct: string }
interface Test { id: string; name: string; code: string | null; price: string; gstRatePct: string }
interface MedLine { med: Med; qty: number }

const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "YYYY-MM-DD" of an instant in the hospital's calendar. */
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-teal)]";

export function ForgottenBillDialog({
  admissionId, ipNumber, admittedAt, dischargedAt, onCreated, onClose,
}: {
  admissionId: string;
  ipNumber: string;
  /** The stay's bounds - the bill date must fall between them. */
  admittedAt: string;
  dischargedAt: string | null;
  /** A bill was raised - the sheet reloads its totals. */
  onCreated: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"PHARMACY" | "LAB">("PHARMACY");
  const [meds, setMeds] = useState<Med[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [q, setQ] = useState("");
  const [medLines, setMedLines] = useState<MedLine[]>([]);
  const [testIds, setTestIds] = useState<Set<string>>(new Set());
  const [fromStock, setFromStock] = useState(true);
  const [disc, setDisc] = useState(0);
  const firstDay = istDay(new Date(admittedAt));
  const lastDay = istDay(dischargedAt ? new Date(dischargedAt) : new Date());
  const [billDate, setBillDate] = useState(lastDay);
  // Raised = paid, unless the desk unticks it (the owner's rule).
  const [payNow, setPayNow] = useState(true);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string } | null>(null);
  const [done, setDone] = useState<{ invoiceId: string; receiptNo: string; total: string } | null>(null);

  useEffect(() => {
    api.get<{ medicines: Med[] }>("/pharmacy/medicines").then((r) => setMeds(r.medicines)).catch(() => setMeds([]));
    api.get<{ catalog: Test[] }>("/labs/catalog").then((r) => setTests(r.catalog)).catch(() => setTests([]));
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && !repeat) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, repeat, onClose]);

  const s = q.trim().toLowerCase();
  const medHits = s ? meds.filter((m) => m.name.toLowerCase().includes(s)).slice(0, 8) : [];
  const testHits = s ? tests.filter((t) => t.name.toLowerCase().includes(s) || (t.code ?? "").toLowerCase().includes(s)).slice(0, 10) : [];

  const calcLines: CalcLine[] = kind === "PHARMACY"
    ? medLines.map((l) => ({ description: l.med.name, qty: l.qty, unitPrice: Number(l.med.unitMrp ?? 0), gstRatePct: Number(l.med.gstRatePct) }))
    : tests.filter((t) => testIds.has(t.id)).map((t) => ({ description: t.name, qty: 1, unitPrice: Number(t.price), gstRatePct: Number(t.gstRatePct) }));
  // null while the bill cannot be raised: nothing picked, or a discount above the subtotal.
  let totals: ReturnType<typeof computeInvoiceTotals> | null = null;
  try { totals = calcLines.length ? computeInvoiceTotals(calcLines, disc) : null; } catch { totals = null; }
  const subtotal = calcLines.reduce((sum, l) => sum + (l.qty ?? 1) * l.unitPrice, 0);

  const short = kind === "PHARMACY" && fromStock ? medLines.filter((l) => l.qty > l.med.inStock) : [];
  const unpriced = kind === "PHARMACY" ? medLines.filter((l) => !l.med.unitMrp) : [];
  const dateOk = billDate >= firstDay && billDate <= lastDay;
  const canSubmit = !busy && !!totals && dateOk && short.length === 0 && unpriced.length === 0 && (!payNow || payValid);

  function addMed(m: Med) {
    setMedLines((p) => (p.some((l) => l.med.id === m.id) ? p : [...p, { med: m, qty: 1 }]));
    setQ("");
  }
  function switchKind(k: "PHARMACY" | "LAB") { setKind(k); setQ(""); setDisc(0); setErr(null); }

  async function submit(confirmRepeat = false) {
    setBusy(true); setErr(null);
    try {
      const common = {
        discountAmount: disc || undefined,
        payments: payNow && payments.length ? payments : undefined,
        confirmRepeat: confirmRepeat || undefined,
        billDate,
      };
      const body = kind === "PHARMACY"
        ? { kind, fromStock, items: medLines.map((l) => ({ medicineId: l.med.id, qty: l.qty })), ...common }
        : { kind, catalogIds: [...testIds], ...common };
      const r = await api.post<{ invoiceId: string; receiptNo: string; total: string }>(`/ipd/admissions/${admissionId}/forgotten-bill`, body);
      setRepeat(null);
      setDone(r);
      onCreated();
    } catch (e) {
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message }); return; }
      setRepeat(null);
      setErr(e instanceof ApiClientError ? e.message : "Couldn't raise the bill.");
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="fb-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="surface flex max-h-[92vh] w-full max-w-2xl flex-col bg-white">
        <div className="shrink-0 border-b border-[var(--p-border)] px-5 py-4">
          <h3 id="fb-title" className="text-[15px] font-semibold text-[var(--p-ink)]">Add a forgotten bill · {ipNumber}</h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
            For something given during this stay that was never billed. It gets its own receipt and shows on the detailed bill.
          </p>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><Icon name="check" size={22} /></span>
            <p className="text-[15px] font-semibold text-[var(--p-ink)]">Bill {done.receiptNo} added to {ipNumber}</p>
            <p className="text-[13px] text-[var(--p-muted)]">₹{money(Number(done.total))}</p>
            <div className="mt-2 flex gap-2">
              <a href={`/print/invoice/${done.invoiceId}?print=1`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)]">
                <Icon name="printer" size={14} /> Print bill
              </a>
              <button type="button" onClick={onClose}
                className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[13px] font-medium text-[var(--p-text)]">Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <div className="inline-flex rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-1">
                {(["PHARMACY", "LAB"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => switchKind(k)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-[13px] font-semibold ${kind === k ? "bg-white text-[var(--p-ink)] shadow-sm" : "text-[var(--p-muted)]"}`}>
                    <Icon name={k === "PHARMACY" ? "pill" : "flask"} size={14} /> {k === "PHARMACY" ? "Pharmacy" : "Lab"}
                  </button>
                ))}
              </div>

              <div className="relative">
                <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3 py-2">
                  <Icon name="search" size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                    placeholder={kind === "PHARMACY" ? "Search a medicine…" : "Search a test…"} className="w-full text-sm outline-none" />
                </div>
                {kind === "PHARMACY" && medHits.length > 0 && (
                  <div className="mt-1.5 divide-y divide-[var(--p-border)] rounded-lg border border-[var(--p-border)]">
                    {medHits.map((m) => (
                      <button key={m.id} type="button" onClick={() => addMed(m)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--p-bg)]">
                        <span className="text-[13px] text-[var(--p-ink)]">{m.name}</span>
                        <span className="shrink-0 text-[12px] text-[var(--p-muted)]">
                          {m.unitMrp ? `₹${m.unitMrp}/${m.unit}` : "no price"} · {m.inStock} in stock
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {kind === "LAB" && testHits.length > 0 && (
                  <div className="mt-1.5 divide-y divide-[var(--p-border)] rounded-lg border border-[var(--p-border)]">
                    {testHits.map((t) => (
                      <label key={t.id} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-[var(--p-bg)]">
                        <span className="flex items-center gap-2 text-[13px] text-[var(--p-ink)]">
                          <input type="checkbox" checked={testIds.has(t.id)} className="h-4 w-4 accent-[var(--p-teal)]"
                            onChange={() => setTestIds((p) => { const n = new Set(p); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
                          {t.name}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-[var(--p-muted)]">₹{t.price}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {kind === "PHARMACY" ? (
                <>
                  {medLines.length > 0 && (
                    <div className="divide-y divide-[var(--p-border)] rounded-lg border border-[var(--p-border)]">
                      {medLines.map((l) => (
                        <div key={l.med.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[var(--p-ink)]">{l.med.name}</span>
                            <span className={`block text-[11.5px] ${fromStock && l.qty > l.med.inStock ? "text-[var(--p-rose)]" : "text-[var(--p-muted)]"}`}>
                              {l.med.unitMrp ? `₹${l.med.unitMrp} per ${l.med.unit}` : "No price on file"} · {l.med.inStock} in stock
                              {fromStock && l.qty > l.med.inStock && " - not enough to take from stock"}
                            </span>
                          </span>
                          <input value={l.qty} inputMode="numeric"
                            onChange={(e) => { const n = Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1); setMedLines((p) => p.map((x) => (x.med.id === l.med.id ? { ...x, qty: n } : x))); }}
                            className="w-16 rounded-lg border border-[var(--p-border)] px-2 py-1 text-center font-mono text-[13px] outline-none focus:border-[var(--p-teal)]" />
                          <span className="w-20 text-right font-mono text-[13px] text-[var(--p-ink)]">₹{money(l.qty * Number(l.med.unitMrp ?? 0))}</span>
                          <button type="button" onClick={() => setMedLines((p) => p.filter((x) => x.med.id !== l.med.id))} aria-label="Remove"
                            className="text-[var(--p-muted)] hover:text-[var(--p-rose)]"><Icon name="x" size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* The one question only the desk can answer. */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {([[true, "Take from stock", "The medicines left the shelf but the system never recorded it. Stock goes down, oldest batch first."],
                       [false, "Just bill", "Stock is already right. Only the bill is missing - no stock moves."]] as const).map(([v, title, sub]) => (
                      <label key={title} className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${fromStock === v ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)]/40" : "border-[var(--p-border)]"}`}>
                        <input type="radio" name="fb-stock" checked={fromStock === v} onChange={() => setFromStock(v)} className="mt-0.5 h-4 w-4 accent-[var(--p-teal)]" />
                        <span>
                          <span className="block text-[13px] font-semibold text-[var(--p-ink)]">{title}</span>
                          <span className="block text-[11.5px] leading-snug text-[var(--p-muted)]">{sub}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              ) : testIds.size > 0 && (
                <div className="divide-y divide-[var(--p-border)] rounded-lg border border-[var(--p-border)]">
                  {tests.filter((t) => testIds.has(t.id)).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-[13px] text-[var(--p-ink)]">{t.name}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-mono text-[13px]">₹{t.price}</span>
                        <button type="button" aria-label="Remove" className="text-[var(--p-muted)] hover:text-[var(--p-rose)]"
                          onClick={() => setTestIds((p) => { const n = new Set(p); n.delete(t.id); return n; })}><Icon name="x" size={14} /></button>
                      </span>
                    </div>
                  ))}
                  <p className="px-3 py-2 text-[11.5px] text-[var(--p-muted)]">Bill only - no test is sent to the lab queue.</p>
                </div>
              )}

              {calcLines.length > 0 && (
                <div className="space-y-3 rounded-lg border border-[var(--p-border)] p-4">
                  <label className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--p-text)]">
                    <span>
                      <span className="font-medium">Bill date</span>
                      <span className="block text-[11.5px] text-[var(--p-muted)]">The day in the stay it belongs to - printed on the invoice.</span>
                    </span>
                    <input type="date" value={billDate} min={firstDay} max={lastDay} onChange={(e) => setBillDate(e.target.value)}
                      className={`rounded-lg border px-3 py-1.5 text-[13px] outline-none ${dateOk ? "border-[var(--p-border)] focus:border-[var(--p-teal)]" : "border-[var(--p-rose)]"}`} />
                  </label>
                  {!dateOk && <p className="text-[12px] text-[var(--p-rose)]">Pick a day between {firstDay} and {lastDay}.</p>}
                  <DiscountInput key={kind} subtotal={subtotal} accent="teal" onChange={(d) => setDisc(d.amount)} />
                  <div className="flex justify-between text-[14px]">
                    <span className="font-semibold text-[var(--p-ink)]">Bill total</span>
                    <span className="font-mono font-semibold text-[var(--p-ink)]">₹{money(totals?.total ?? 0)}</span>
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--p-text)]">
                    <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-[var(--p-teal)]" />
                    Collect payment now
                  </label>
                  {payNow ? (
                    <>
                      <PaymentSection total={totals?.total ?? 0} accent="teal" onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }} />
                      <p className="text-[11.5px] text-[var(--p-muted)]">The bill comes out Paid. The payment is recorded now, so it counts in today&apos;s day close under your name.</p>
                    </>
                  ) : <p className="text-[12px] text-[var(--p-muted)]">Left unpaid, it shows as due on this stay until it is collected at Billing.</p>}
                </div>
              )}

              {err && <p className="rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[12.5px] text-[var(--p-rose)]">{err}</p>}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
              <button type="button" onClick={onClose} disabled={busy}
                className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <button type="button" onClick={() => void submit()} disabled={!canSubmit}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--p-teal-deep)] disabled:opacity-45">
                {busy ? <><Spinner /> Raising…</> : <><Icon name="receipt" size={14} /> Raise bill{totals ? ` · ₹${money(totals.total)}` : ""}</>}
              </button>
            </div>
          </>
        )}
      </div>

      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block} message={repeat.message} busy={busy}
          onConfirm={() => { void submit(true); }}
          onClose={() => setRepeat(null)}
        />
      )}
    </div>
  );
}
