"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { GhostButton } from "@/components/portal/pharmacy/procurement-ui";
import { PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/realtime/use-live";
import { TOPICS } from "@/lib/realtime/topics";

/**
 * THE COUNTER'S DEBTORS.
 *
 * An inpatient's medicine leaves this counter without being paid for - that is
 * the point of billing pharmacy separately from the stay. The risk that creates
 * is simple: nobody is standing at the window to remind you. This screen is the
 * reminder. Ward bills sit at the top because a discharge is refused while one
 * of them is open, so every row here is somebody waiting to go home.
 */

interface Due {
  invoiceId: string; receiptNo: string; createdAt: string;
  total: string; paid: string; due: string;
  patient: { id: string; displayId: string; fullName: string; phone: string | null };
  ipNumber: string | null; ward: string | null; bedNo: string | null;
  stillAdmitted: boolean; summary: string;
}
/** One admitted patient, every open ward bill of theirs rolled together. */
interface IpdDue {
  patient: { id: string; displayId: string; fullName: string; phone: string | null };
  ipNumber: string | null; ward: string | null; bedNo: string | null;
  stillAdmitted: boolean;
  bills: { invoiceId: string; receiptNo: string; due: string; createdAt: string; summary: string }[];
  billCount: number; due: string; oldestAt: string;
}
interface DuesResponse {
  dues: Due[]; ipdByPatient: IpdDue[];
  ipdCount: number; ipdTotal: string; count: number; totalDue: string;
}

const money = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const ageInDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

export default function PharmacyDuesPage() {
  const [data, setData] = useState<DuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [collect, setCollect] = useState<Due | null>(null);
  /** A ward patient's whole debt, settled in one payment. */
  const [settle, setSettle] = useState<IpdDue | null>(null);

  /**
   * `quiet` is what makes a live refresh feel live rather than broken. The first
   * load shows a spinner; every later one swaps the numbers underneath without
   * blanking the screen, because a list that flashes to "Loading…" every time
   * another counter takes money reads as a fault, not a feature.
   */
  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    return api.get<DuesResponse>("/pharmacy/dues")
      .then(setData).catch(() => {}).finally(() => { if (!quiet) setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  // A ward dispense adds a due; a payment anywhere clears one.
  // Suspended while the collect sheet is open - refreshing the list out from
  // under someone who is counting cash is worse than being a few seconds stale.
  // Suspended while EITHER sheet is open - refreshing the list out from under
  // someone who is counting cash is worse than being a few seconds stale.
  useLive([TOPICS.PHARMACY], () => load(true), { enabled: !collect && !settle });

  // Ward dues come pre-grouped by patient from the service (ipdByPatient);
  // only the counter's own walk-in bills are still listed one per invoice.
  const counter = data?.dues.filter((d) => d.ipNumber === null) ?? [];

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-end justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Dues to collect</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--p-muted)]">
            Medicine that has left this counter but has not been paid for. Ward bills are
            listed first — a patient cannot be discharged until theirs is settled here.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Outstanding</div>
          <div className={`font-mono text-[26px] font-bold ${Number(data?.totalDue ?? 0) > 0 ? "text-[var(--p-amber)]" : "text-[var(--p-ink)]"}`}>
            ₹{money(data?.totalDue ?? 0)}
          </div>
          <div className="text-[12px] text-[var(--p-muted)]">
            {data?.count ?? 0} bill{data?.count === 1 ? "" : "s"}
            {(data?.ipdCount ?? 0) > 0 && ` · ${data!.ipdCount} on the ward`}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (data?.count ?? 0) === 0 ? (
        <div data-rise className="surface dotgrid flex flex-col items-center py-20 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--p-border)] bg-white text-[var(--p-teal)]">
            <Icon name="check" size={24} />
          </span>
          <p className="mt-4 text-[14px] font-medium text-[var(--p-ink)]">Nothing outstanding.</p>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Every bill this counter has raised has been paid.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <WardDueSection rows={data?.ipdByPatient ?? []} onCollect={setSettle} />
          <DueSection
            title="At the counter" tone="plain"
            sub="Walk-in sales left part-paid or unpaid."
            rows={counter} onCollect={setCollect}
          />
        </div>
      )}

      {collect && (
        <CollectModal
          due={collect}
          onClose={() => setCollect(null)}
          onDone={() => { setCollect(null); load(); }}
        />
      )}
      {settle && (
        <SettleAllModal
          p={settle}
          onClose={() => setSettle(null)}
          onDone={() => { setSettle(null); load(); }}
        />
      )}
    </PortalScroll>
  );
}

/**
 * THE WARD LIST, ONE ROW PER PATIENT.
 *
 * A ward patient is dispensed to several times over a stay, and each dispense is
 * its own invoice. Listed one per invoice, bed 12 was four separate rows - so the
 * counter settled the one the family asked about and left three behind, which
 * nobody went looking for until the discharge desk refused to let them go.
 *
 * The row is the person and the figure is everything they owe. The individual
 * bills are still there, one click down, because each is its own tax document
 * and money is taken against ONE of them at a time - a single "collect ₹1,240"
 * button would have to invent an invoice that does not exist.
 */
function WardDueSection({ rows, onCollect }: { rows: IpdDue[]; onCollect: (p: IpdDue) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + Number(r.due), 0);

  return (
    <section data-rise className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-6 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-[#8a6414]">
            <Icon name="alert" size={15} /> On the ward
          </h3>
          <p className="mt-0.5 text-[12px] text-[#8a6414]">
            One row per patient. Their discharge is waiting on this.
          </p>
        </div>
        <div className="font-mono text-[15px] font-bold text-[#8a6414]">₹{money(total)}</div>
      </div>

      <div className="divide-y divide-[var(--p-border)]">
        {rows.map((p) => (
          <div key={p.patient.id}>
            <button onClick={() => setOpen(open === p.patient.id ? null : p.patient.id)}
              className="flex w-full flex-wrap items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-[var(--p-bg)]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-[var(--p-ink)]">{p.patient.fullName}</span>
                  <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{p.patient.displayId}</span>
                  {p.stillAdmitted ? (
                    <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a6414]">In bed</span>
                  ) : (
                    <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-rose)]">Discharged — unpaid</span>
                  )}
                </div>
                <div className="mt-1 text-[12px] text-[var(--p-muted)]">
                  {p.ipNumber && <><span className="font-mono">{p.ipNumber}</span>{" · "}</>}
                  {p.ward && `${p.ward}${p.bedNo ? ` bed ${p.bedNo}` : ""} · `}
                  {p.billCount} bill{p.billCount === 1 ? "" : "s"} · oldest {day(p.oldestAt)}
                  {ageInDays(p.oldestAt) >= 1 && ` (${ageInDays(p.oldestAt)}d ago)`}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="font-mono text-[17px] font-bold text-[var(--p-amber)]">₹{money(p.due)}</div>
                  <div className="text-[11px] text-[var(--p-muted)]">total owed</div>
                </div>
                {/* ONE BUTTON, THE WHOLE DEBT.
                    The family hands over one amount; the allocation across their
                    open bills happens in settleDues. A button per bill is what
                    let three of four go unsettled. */}
                <span
                  role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onCollect(p); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onCollect(p); } }}
                  className="btn-primary inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white">
                  <Icon name="rupee" size={14} /> Collect ₹{money(p.due)}
                </span>
                <span className={`text-[var(--p-muted)] transition-transform ${open === p.patient.id ? "rotate-90" : ""}`}>
                  <Icon name="chevron" size={16} />
                </span>
              </div>
            </button>

            {/* The bills themselves stay reachable - somebody always asks
                "what is this for", and each one still prints on its own. Only
                the collecting is combined. */}
            {open === p.patient.id && (
              <div className="space-y-1.5 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-6 py-3">
                {p.bills.map((b) => (
                  <div key={b.invoiceId} className="flex flex-wrap items-center justify-between gap-3 py-1">
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{b.receiptNo}</span>
                      <span className="text-[12px] text-[var(--p-muted)]"> · {day(b.createdAt)} · {b.summary}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[13.5px] font-semibold text-[var(--p-amber)]">₹{money(b.due)}</span>
                      <Link href={`/print/invoice/${b.invoiceId}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border-strong)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--p-ink)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                        <Icon name="receipt" size={13} /> Bill
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function DueSection({
  title, sub, tone, rows, onCollect,
}: { title: string; sub: string; tone: "amber" | "plain"; rows: Due[]; onCollect: (d: Due) => void }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + Number(r.due), 0);
  return (
    <section data-rise className="surface overflow-hidden">
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-6 py-4 ${
        tone === "amber" ? "bg-[var(--p-amber-soft)]" : ""
      }`}>
        <div>
          <h3 className={`flex items-center gap-2 text-[14px] font-semibold ${tone === "amber" ? "text-[#8a6414]" : "text-[var(--p-ink)]"}`}>
            {tone === "amber" && <Icon name="alert" size={15} />}
            {title}
          </h3>
          <p className={`mt-0.5 text-[12px] ${tone === "amber" ? "text-[#8a6414]" : "text-[var(--p-muted)]"}`}>{sub}</p>
        </div>
        <div className={`font-mono text-[15px] font-bold ${tone === "amber" ? "text-[#8a6414]" : "text-[var(--p-ink)]"}`}>
          ₹{money(total)}
        </div>
      </div>
      <div className="divide-y divide-[var(--p-border)]">
        {rows.map((d) => (
          <div key={d.invoiceId} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 transition-colors hover:bg-[var(--p-bg)]">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-[var(--p-ink)]">{d.patient.fullName}</span>
                <span className="font-mono text-[11.5px] text-[var(--p-muted)]">{d.patient.displayId}</span>
                {d.stillAdmitted && (
                  <span className="rounded-full bg-[var(--p-amber-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#8a6414]">
                    In bed
                  </span>
                )}
                {d.ipNumber && !d.stillAdmitted && (
                  <span className="rounded-full bg-[var(--p-rose-soft)] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-rose)]">
                    Discharged — unpaid
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] text-[var(--p-muted)]">
                <span className="font-mono">{d.receiptNo}</span>
                {" · "}{day(d.createdAt)}
                {ageInDays(d.createdAt) >= 1 && ` (${ageInDays(d.createdAt)}d ago)`}
                {d.ipNumber && <> · <span className="font-mono">{d.ipNumber}</span></>}
                {d.ward && ` · ${d.ward}${d.bedNo ? ` bed ${d.bedNo}` : ""}`}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-[var(--p-muted)]">{d.summary}</div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="font-mono text-[17px] font-bold text-[var(--p-amber)]">₹{money(d.due)}</div>
                {Number(d.paid) > 0 && (
                  <div className="text-[11px] text-[var(--p-muted)]">₹{money(d.paid)} of ₹{money(d.total)} paid</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/print/invoice/${d.invoiceId}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border-strong)] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[var(--p-ink)] transition-colors hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                  <Icon name="receipt" size={14} /> Print bill
                </Link>
                <button onClick={() => onCollect(d)}
                  className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold text-white">
                  <Icon name="rupee" size={14} /> Collect
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * ONE PAYMENT, EVERY OPEN BILL of one ward patient.
 *
 * The family hands over one amount. `settleDues` spreads it across their bills
 * oldest-first and stamps a Payment against each, so every invoice stays its own
 * document and the tender modes reach the day close unchanged.
 *
 * Part-payment is allowed and is the reason the allocation is oldest-first: ₹500
 * against ₹1,240 clears the oldest slips outright rather than leaving all four
 * part-paid, which is the state nobody can reconcile later.
 */
function SettleAllModal({ p, onClose, onDone }: { p: IpdDue; onClose: () => void; onDone: () => void }) {
  const [payments, setPayments] = useState<Tender[]>([]);
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ settled: { receiptNo: string; applied: string }[] }>(
        "/billing/settle-dues",
        { patientId: p.patient.id, source: "PHARMACY", payments }
      );
      // Every bill the money actually landed on prints, so the family leaves
      // holding a receipt for each - one combined slip would be a document the
      // hospital never raised.
      for (const s of r.settled) {
        const bill = p.bills.find((b) => b.receiptNo === s.receiptNo);
        if (bill) window.open(`/print/invoice/${bill.invoiceId}`, "_blank", "noopener,noreferrer");
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record the payment");
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      title={`Collect ₹${money(p.due)}`}
      sub={`${p.patient.fullName} · ${p.billCount} bill${p.billCount === 1 ? "" : "s"}${p.ipNumber ? ` · ${p.ipNumber}` : ""}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <button onClick={submit} disabled={busy || !valid}
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-5 py-3 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none">
            {busy ? <Spinner /> : <Icon name="check" size={15} />}
            {busy ? "Recording…" : "Record & print"}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[12.5px] text-[var(--p-muted)]">
          {p.bills.map((b) => (
            <div key={b.invoiceId} className="flex justify-between gap-3 py-0.5">
              <span className="min-w-0 truncate"><span className="font-mono">{b.receiptNo}</span> · {day(b.createdAt)}</span>
              <span className="shrink-0 font-mono text-[var(--p-ink)]">₹{money(b.due)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-[var(--p-border)] pt-1 font-semibold">
            <span className="text-[var(--p-ink)]">Total due</span>
            <span className="font-mono text-[var(--p-amber)]">₹{money(p.due)}</span>
          </div>
          <p className="mt-2 leading-relaxed">
            Paying less than the total settles the oldest bills first.
          </p>
        </div>

        <PaymentSection total={Number(p.due)} accent="blue" onChange={(r) => { setPayments(r.payments); setValid(r.valid); }} />

        {err && (
          <div className="rounded-lg border border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)] px-4 py-3 text-[12.5px] text-[var(--p-rose)]">
            {err}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * Settling a due goes through the same payment endpoint as a counter sale, so the
 * money lands in the same day-close totals under the same modes. Nothing about a
 * ward bill is a special kind of rupee.
 */
function CollectModal({ due, onClose, onDone }: { due: Due; onClose: () => void; onDone: () => void }) {
  const [payments, setPayments] = useState<Tender[]>([]);
  const [valid, setValid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amount = Number(due.due);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.post("/billing/payment", { invoiceId: due.invoiceId, payments });
      // Print straight after collecting - the family leaves with the receipt.
      window.open(`/print/invoice/${due.invoiceId}`, "_blank", "noopener,noreferrer");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not record the payment");
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      title={`Collect ₹${money(due.due)}`}
      sub={`${due.patient.fullName} · ${due.receiptNo}${due.ipNumber ? ` · ${due.ipNumber}` : ""}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>Cancel</GhostButton>
          <button onClick={submit} disabled={busy || !valid}
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-5 py-3 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45 sm:flex-none">
            {busy ? <Spinner /> : <Icon name="check" size={15} />}
            {busy ? "Recording…" : "Record & print"}
          </button>
        </>
      }
    >
      <div className="space-y-4 px-6 py-5">
        <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[12.5px] text-[var(--p-muted)]">
          <div className="flex justify-between"><span>Bill total</span><span className="font-mono text-[var(--p-ink)]">₹{money(due.total)}</span></div>
          {Number(due.paid) > 0 && (
            <div className="mt-1 flex justify-between"><span>Already paid</span><span className="font-mono text-[var(--p-ink)]">₹{money(due.paid)}</span></div>
          )}
          <div className="mt-1 flex justify-between border-t border-[var(--p-border)] pt-1 font-semibold">
            <span className="text-[var(--p-ink)]">Now due</span><span className="font-mono text-[var(--p-amber)]">₹{money(due.due)}</span>
          </div>
          <p className="mt-2 leading-relaxed">{due.summary}</p>
        </div>

        <PaymentSection total={amount} accent="blue" onChange={(r) => { setPayments(r.payments); setValid(r.valid); }} />

        {err && (
          <div className="rounded-lg border border-[var(--p-rose)]/30 bg-[var(--p-rose-soft)] px-4 py-3 text-[12.5px] text-[var(--p-rose)]">
            {err}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * A panel that rises from the BOTTOM of the screen rather than sitting in the
 * middle of it.
 *
 * The counter this runs on is a tablet lying flat beside the till. A centred
 * dialog puts the amount and the Record button in the middle of the glass, which
 * is the one part of a flat tablet a standing pharmacist has to reach across the
 * screen for - and it hides the row they just tapped, so they lose their place in
 * the list. Anchoring to the bottom keeps the dues visible above the sheet and
 * the buttons under the thumb.
 *
 * Escape closes it, but never mid-save: a half-recorded payment with the sheet
 * already gone is how money goes missing from a day-close.
 */
function BottomSheet({
  title, sub, busy, onClose, children, footer,
}: {
  title: string; sub?: string; busy?: boolean;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onEsc);
    // Stop the page behind from scrolling under the sheet - on a touch screen a
    // stray drag otherwise scrolls the list instead of the sheet's contents.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  return (
    <div className="sheet-veil" role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sheet-panel">
        <div className="sheet-grip" aria-hidden />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--p-border)] px-6 py-3.5">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[var(--p-ink)]">{title}</h3>
            {sub && <p className="mt-0.5 truncate text-[12px] text-[var(--p-muted)]">{sub}</p>}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-[var(--p-muted)] transition-colors hover:bg-[var(--p-bg)] hover:text-[var(--p-ink)] disabled:opacity-40">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--p-border)] px-6 py-4">
          {footer}
        </div>
      </div>
    </div>
  );
}
