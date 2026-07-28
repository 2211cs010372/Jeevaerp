"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { localDateISO } from "@/lib/date";

/* ── types ─────────────────────────────────────────────────────────────── */
interface Bill {
  id: string; receiptNo: string; source: string; status: string;
  totalAmount: string; createdAt: string;
  patient: { displayId: string; fullName: string };
}
interface EInvoice {
  status: "NOT_APPLICABLE" | "PENDING" | "GENERATED" | "FAILED" | "CANCELLED";
  provider: string; irn: string | null; ackNo: string | null; ackDt: string | null;
  signedQrCode: string | null; errorCode: string | null; errorMessage: string | null;
  cancelledAt: string | null; cancelReason: string | null; generatedAt: string | null;
  reasons: string[]; automatic: boolean;
}
interface TallyPreview {
  filename: string;
  counts: { sales: number; receipts: number; creditNotes: number };
  skipped: { receiptNo: string; reason: string }[];
  vouchers: number;
}

const inr = (v: string | number) =>
  "₹" + Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SRC_LABEL: Record<string, string> = {
  CONSULTATION: "Consultation", LAB: "Lab", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other",
};
const fld =
  "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

export default function AdminAccountsPage() {
  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Accounts &amp; compliance</h1>
        <p className="mt-1 text-[13px] text-[var(--p-muted)]">
          Hand the books to the CA, and register B2B bills with the GST portal.
        </p>
      </div>
      <div className="space-y-6">
        <TallyPanel />
        <EInvoicePanel />
      </div>
    </PortalScroll>
  );
}

/* ── Tally ─────────────────────────────────────────────────────────────── */

function TallyPanel() {
  const today = localDateISO();
  // Defaults to the current month, which is the range an accountant asks for
  // far more often than any other.
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState<TallyPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true); setError(null); setPreview(null);
    try { setPreview(await api.get<TallyPreview>(`/admin/export/tally?from=${from}&to=${to}`)); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't build the export."); }
    finally { setBusy(false); }
  }

  // The download goes through the browser rather than fetch+blob so the
  // Content-Disposition filename from the server is what lands on disk.
  const downloadHref = `/api/v1/admin/export/tally?from=${from}&to=${to}&download=1`;

  return (
    <section data-rise className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-6 py-4">
        <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Tally export</h2>
        <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
          Sales, receipts and credit notes as Tally vouchers. Imports straight into the company file — no retyping.
        </p>
      </div>

      <div className="px-6 py-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40"><Field label="From"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={fld} /></Field></div>
          <div className="w-40"><Field label="To"><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={fld} /></Field></div>
          <PrimaryButton onClick={check} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="search" size={15} />} Check
          </PrimaryButton>
          {preview && preview.vouchers > 0 && (
            <a href={downloadHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90">
              <Icon name="file" size={14} /> Download XML
            </a>
          )}
        </div>

        {error && <p className="mt-3 text-[13px] text-[var(--p-rose)]">{error}</p>}

        {preview && (
          <div className="mt-5">
            <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--p-border)] bg-[var(--p-border)] sm:grid-cols-4">
              <Stat label="Sales" value={preview.counts.sales} />
              <Stat label="Receipts" value={preview.counts.receipts} />
              <Stat label="Credit notes" value={preview.counts.creditNotes} />
              <Stat label="Total vouchers" value={preview.vouchers} strong />
            </div>

            {preview.vouchers === 0 && (
              <p className="mt-3 text-[12.5px] text-[var(--p-muted)]">Nothing billed in this range.</p>
            )}

            {/* Shown BEFORE the download on purpose. Finding out inside Tally
                that bills were skipped means unpicking a finished import. */}
            {preview.skipped.length > 0 && (
              <div className="mt-4 rounded-lg border border-[var(--p-border)] bg-[var(--p-amber-soft)] px-4 py-3">
                <p className="text-[12px] font-semibold text-[#8a6414]">
                  {preview.skipped.length} bill{preview.skipped.length === 1 ? "" : "s"} not included
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {preview.skipped.slice(0, 12).map((s) => (
                    <li key={s.receiptNo} className="text-[11.5px] text-[#8a6414]">
                      <span className="font-mono">{s.receiptNo}</span> — {s.reason}
                    </li>
                  ))}
                  {preview.skipped.length > 12 && (
                    <li className="text-[11.5px] text-[#8a6414]">…and {preview.skipped.length - 12} more.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</p>
      <p className={`mt-0.5 tabular-nums ${strong ? "text-[19px] font-bold text-[var(--p-blue)]" : "text-[17px] font-semibold text-[var(--p-ink)]"}`}>{value}</p>
    </div>
  );
}

/* ── e-Invoice ─────────────────────────────────────────────────────────── */

function EInvoicePanel() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Bill | null>(null);

  useEffect(() => {
    api.get<{ invoices: Bill[] }>("/admin/bills").then((r) => setBills(r.invoices)).catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return bills.slice(0, 8);
    return bills
      .filter((b) => b.receiptNo.toLowerCase().includes(t) || b.patient.fullName.toLowerCase().includes(t) || b.patient.displayId.toLowerCase().includes(t))
      .slice(0, 8);
  }, [bills, q]);

  return (
    <section data-rise className="surface overflow-hidden">
      <div className="border-b border-[var(--p-border)] px-6 py-4">
        <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">e-Invoicing (IRN)</h2>
        <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
          Only bills raised to a GST-registered buyer — an insurer, a TPA, a corporate client — need an IRN.
          An ordinary patient bill is B2C and is out of scope at any turnover.
        </p>
      </div>

      <div className="px-6 py-5">
        <div className="max-w-md">
          <Field label="Find a bill">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Receipt no, patient name or UHID" className={fld} />
          </Field>
        </div>

        <div className="mt-4 divide-y divide-[var(--p-border)] overflow-hidden rounded-lg border border-[var(--p-border)]">
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--p-muted)]">No bills match.</p>
          ) : shown.map((b) => (
            <button key={b.id} type="button" onClick={() => setSel(b)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--p-bg)] ${sel?.id === b.id ? "bg-[var(--p-blue-soft)]" : "bg-white"}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12.5px] font-semibold text-[var(--p-ink)]">{b.receiptNo}</span>
                  <span className="rounded bg-[var(--p-border)]/50 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--p-muted)]">{SRC_LABEL[b.source] ?? b.source}</span>
                </div>
                <div className="truncate text-[11.5px] text-[var(--p-muted)]">{b.patient.fullName} · {b.patient.displayId}</div>
              </div>
              <span className="shrink-0 font-mono text-[12.5px] text-[var(--p-ink)]">{inr(b.totalAmount)}</span>
            </button>
          ))}
        </div>

        {sel && <EInvoiceDetail bill={sel} key={sel.id} />}
      </div>
    </section>
  );
}

function EInvoiceDetail({ bill }: { bill: Bill }) {
  const [ei, setEi] = useState<EInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [buyer, setBuyer] = useState({ gstin: "", legalName: "", address: "" });
  const [manual, setManual] = useState({ irn: "", ackNo: "", ackDt: "", signedQrCode: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setEi((await api.get<{ eInvoice: EInvoice }>(`/admin/einvoice/${bill.id}`)).eInvoice); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load status."); }
    finally { setLoading(false); }
  }, [bill.id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<{ eInvoice: EInvoice }>, ok: string) {
    setBusy(true); setError(null); setNote(null);
    try { setEi((await fn()).eInvoice); setNote(ok); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "That didn't work."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="mt-5 flex items-center gap-2 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>;

  const registered = ei?.status === "GENERATED";

  return (
    <div className="mt-5 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-[13px] font-semibold text-[var(--p-ink)]">{bill.receiptNo}</h3>
        <StatusChip status={ei?.status ?? "PENDING"} />
      </div>

      {error && <p className="mt-3 text-[12.5px] text-[var(--p-rose)]">{error}</p>}
      {note && <p className="mt-3 text-[12.5px] text-[var(--p-cyan-deep)]">{note}</p>}

      {registered ? (
        <div className="mt-4 space-y-1.5 rounded-lg border border-[var(--p-border)] bg-white p-4">
          <p className="break-all font-mono text-[11px] text-[var(--p-ink)]"><span className="font-bold">IRN </span>{ei!.irn}</p>
          <p className="font-mono text-[11.5px] text-[var(--p-muted)]">
            Ack {ei!.ackNo} · {ei!.ackDt ? new Date(ei!.ackDt).toLocaleDateString("en-IN") : "-"} · via {ei!.provider}
          </p>
          <p className="pt-1 text-[11.5px] text-[var(--p-muted)]">
            The IRN and its signed QR now print on this bill.
          </p>
        </div>
      ) : (
        <>
          {/* Why it can't be registered. Almost always "this is a B2C bill",
              which is a correct answer and not an error. */}
          {ei && ei.reasons.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg border border-[var(--p-border)] bg-white px-4 py-3">
              {ei.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-[var(--p-muted)]">
                  <span className="text-[var(--p-amber)]">•</span>{r}
                </li>
              ))}
            </ul>
          )}

          {ei?.status === "FAILED" && ei.errorMessage && (
            <p className="mt-3 rounded-lg bg-[var(--p-rose-soft)] px-4 py-2.5 text-[12px] text-[var(--p-rose)]">
              Portal rejected it{ei.errorCode ? ` (${ei.errorCode})` : ""}: {ei.errorMessage}
            </p>
          )}

          {/* Buyer - what turns a B2C bill into a B2B one */}
          <div className="mt-4">
            <p className="text-[12px] font-semibold text-[var(--p-ink)]">Registered buyer</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <Field label="Buyer GSTIN"><input value={buyer.gstin} onChange={(e) => setBuyer({ ...buyer, gstin: e.target.value.toUpperCase() })} placeholder="36AABCU9603R1ZM" className={`${fld} font-mono`} /></Field>
              <Field label="Registered name"><input value={buyer.legalName} onChange={(e) => setBuyer({ ...buyer, legalName: e.target.value })} placeholder="Star Health Insurance Ltd" className={fld} /></Field>
              <Field label="Address"><input value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} className={fld} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <PrimaryButton disabled={busy || !buyer.gstin || !buyer.legalName}
                onClick={() => run(() => api.put(`/admin/einvoice/${bill.id}`, { buyer: { ...buyer, address: buyer.address || null } }), "Buyer saved.")}>
                {busy ? <Spinner /> : <Icon name="check" size={14} />} Save buyer
              </PrimaryButton>
              <button type="button" disabled={busy}
                onClick={() => run(() => api.put(`/admin/einvoice/${bill.id}`, { buyer: null }), "Buyer cleared — back to B2C.")}
                className="rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                Clear
              </button>
            </div>
          </div>

          {/* Generate, when a provider can reach the portal itself */}
          {ei?.automatic && (
            <div className="mt-5 border-t border-[var(--p-border)] pt-4">
              <PrimaryButton disabled={busy || (ei?.reasons.length ?? 0) > 0}
                onClick={() => run(() => api.post(`/admin/einvoice/${bill.id}`, {}), "Registered with the portal.")}>
                {busy ? <Spinner /> : <Icon name="shield" size={14} />} Generate IRN
              </PrimaryButton>
            </div>
          )}

          {/* Manual: the accountant registered it on the government portal and
              is typing the response back in. */}
          <div className="mt-5 border-t border-[var(--p-border)] pt-4">
            <p className="text-[12px] font-semibold text-[var(--p-ink)]">Record an IRN from the government portal</p>
            <p className="mt-0.5 text-[11.5px] text-[var(--p-muted)]">
              Paste exactly what the portal returned. The QR text is signed — any edit to it makes the printed QR fail verification.
            </p>
            <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
              <Field label="IRN (64 characters)"><input value={manual.irn} onChange={(e) => setManual({ ...manual, irn: e.target.value.trim() })} className={`${fld} font-mono text-[11px]`} /></Field>
              <Field label="Acknowledgement no"><input value={manual.ackNo} onChange={(e) => setManual({ ...manual, ackNo: e.target.value })} className={`${fld} font-mono`} /></Field>
              <Field label="Acknowledgement date"><input type="date" value={manual.ackDt} onChange={(e) => setManual({ ...manual, ackDt: e.target.value })} className={fld} /></Field>
              <Field label="Signed QR text"><textarea value={manual.signedQrCode} onChange={(e) => setManual({ ...manual, signedQrCode: e.target.value })} rows={2} className={`${fld} font-mono text-[10.5px]`} /></Field>
            </div>
            <div className="mt-3">
              <PrimaryButton disabled={busy || !manual.irn || !manual.ackNo || !manual.ackDt || !manual.signedQrCode}
                onClick={() => run(() => api.post(`/admin/einvoice/${bill.id}?action=record`, manual), "IRN recorded — it will print on this bill.")}>
                {busy ? <Spinner /> : <Icon name="check" size={14} />} Record IRN
              </PrimaryButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: EInvoice["status"] }) {
  const map: Record<string, { c: string; t: string }> = {
    GENERATED: { c: "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]", t: "Registered" },
    PENDING: { c: "bg-[var(--p-amber-soft)] text-[var(--p-amber)]", t: "Ready to register" },
    FAILED: { c: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]", t: "Rejected" },
    CANCELLED: { c: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]", t: "Cancelled" },
    NOT_APPLICABLE: { c: "bg-[var(--p-border)]/50 text-[var(--p-muted)]", t: "Not applicable" },
  };
  const s = map[status] ?? map.NOT_APPLICABLE;
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.c}`}>{s.t}</span>;
}
