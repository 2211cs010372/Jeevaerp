"use client";

import { useEffect, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { DispenseScratchpad, type PadLine } from "@/components/portal/pharmacy/scratchpad";
import { DiscountInput, PaymentSection, type Tender } from "@/components/portal/ui/bill-fields";
import { AdmissionBanner, useAdmission } from "@/components/portal/reception/admission-banner";

interface Patient { id: string; displayId: string; fullName: string; phone: string; }
interface Med {
  id: string; name: string; unit: string; gstRatePct: string;
  /** In DISPENSING UNITS - tablets, ml. */
  inStock: number;
  /** Printed MRP PER PACK. Never bill with this - see unitMrp. */
  mrp: string | null;
  /** What one tablet / ml actually costs the patient. */
  unitMrp: string | null;
  packSize: number; packLabel: string | null;
  nearestExpiry: string | null; courseCritical: boolean;
}
type Line = PadLine;

export default function DispensePage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);

  const [meds, setMeds] = useState<Med[]>([]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [disc, setDisc] = useState(0);
  const [shortReason, setShortReason] = useState("");
  const [payNow, setPayNow] = useState(true);
  const [payments, setPayments] = useState<Tender[]>([]);
  const [payValid, setPayValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An admitted patient's medicines are charged to their room, so there is no
  // receipt at the counter. Both outcomes must be renderable.
  const [done, setDone] = useState<{ id?: string; receiptNo: string; total: string } | null>(null);
  // A ward dispense still raises a real pharmacy bill - it is just left unpaid
  // until discharge. Carrying it here is what lets the counter show the family
  // what was added to the tab instead of "trust us, it's on the room".
  const [toRoom, setToRoom] = useState<{ ipNumber: string; invoiceId?: string; total?: string } | null>(null);

  // ── THE IP/OP SWITCH, ASKED AT THE COUNTER ────────────────────────────────
  // A ward patient's chit now comes STRAIGHT here - it does not go past
  // reception first - so this counter is the only place the question gets asked.
  // The moment a patient is picked we ask the bed board, and the answer decides
  // both halves of what happens next: whether money is taken, and whether the
  // prescription files against the stay or against the person.
  const { admission, checking: checkingAdm } = useAdmission(patient?.id);
  const isInpatient = !!admission;

  const [patientTab, setPatientTab] = useState<"search" | "direct">("search");
  const [directName, setDirectName] = useState("");
  const [directPhone, setDirectPhone] = useState("");
  const [directAddress, setDirectAddress] = useState("");
  const [directBusy, setDirectBusy] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("mode") === "direct" || urlParams.get("direct") === "true") {
        setPatientTab("direct");
      }
    }
  }, []);

  useEffect(() => {
    api.get<{ medicines: Med[] }>(`/pharmacy/medicines${search ? `?q=${encodeURIComponent(search)}` : ""}`)
      .then((r) => setMeds(r.medicines)).catch(() => setMeds([]));
  }, [search]);

  useEffect(() => {
    if (patient || !q.trim() || patientTab !== "search") { setResults([]); return; }
    const t = setTimeout(() => {
      api.get<{ patients: Patient[] }>(`/reception/patients?q=${encodeURIComponent(q)}&limit=6`)
        .then((r) => setResults(r.patients)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, patient, patientTab]);

  async function handleDirectSaleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = directName.trim();
    const phone = directPhone.trim();
    const address = directAddress.trim();

    if (!name) { setDirectError("Customer name is required."); return; }
    if (!/^\d{10}$/.test(phone)) { setDirectError("Enter a valid 10-digit mobile number."); return; }

    setDirectBusy(true); setDirectError(null);
    try {
      // Check if a patient with this phone already exists
      const existing = await api.get<{ patients: Patient[] }>(`/reception/patients?q=${encodeURIComponent(phone)}&limit=5`);
      const matched = existing.patients.find((p) => p.phone === phone);
      if (matched) {
        setPatient(matched);
        setDirectBusy(false);
        return;
      }

      // Create a quick walk-in patient record for this direct pill sale
      const res = await api.post<{ patient: Patient }>("/reception/patients", {
        firstName: name,
        phone,
        address: address || undefined,
      });
      setPatient(res.patient);
    } catch (err) {
      setDirectError(err instanceof ApiClientError ? err.message : "Failed to register walk-in customer.");
    } finally {
      setDirectBusy(false);
    }
  }

  function add(m: Med) {
    if (m.inStock === 0) return;
    setLines((p) => p.some((l) => l.medicineId === m.id)
      // SELLING IS IN TABLETS, not packs. Tapping again adds one more tablet.
      // Defaulting to a whole strip forced pack-selling: a patient asking for
      // ten paracetamol would have been given fifteen and billed for fifteen.
      // The "+1 pack" button below is there for when a whole strip IS wanted.
      ? p.map((l) => l.medicineId === m.id ? { ...l, qty: Math.min(l.qty + 1, m.inStock) } : l)
      // Opens at ONE unit. Type 10 and the patient gets exactly ten tablets.
      : [...p, {
          medicineId: m.id, name: m.name, unit: m.unit,
          qty: 1,
          // PER UNIT. Billing the pack price per tablet was a 15x overcharge.
          mrp: Number(m.unitMrp ?? m.mrp ?? 0),
          gst: Number(m.gstRatePct), inStock: m.inStock,
          packSize: Math.max(1, m.packSize), packLabel: m.packLabel,
          prescribedQty: 0, perDay: 0, courseCritical: m.courseCritical, locked: m.courseCritical,
        }]);
  }

  const subtotal = lines.reduce((s, l) => s + l.qty * l.mrp, 0);
  const gst = lines.reduce((s, l) => s + (l.qty * l.mrp * (subtotal > 0 ? 1 - disc / subtotal : 1) * l.gst) / 100, 0);
  const total = subtotal - disc + gst;

  async function submit() {
    if (!patient || !lines.length) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post<{ chargedToRoom: boolean; ipNumber: string | null; invoice: { id: string; receiptNo: string; totalAmount: string } | null }>("/pharmacy/dispense", {
        patientId: patient.id,
        items: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })),
        discountAmount: disc || undefined,
        // An admitted patient settles at discharge. Sending a tender here would
        // be a payment the server is obliged to throw away - better not to
        // collect one in the first place.
        payments: !isInpatient && payNow && payments.length ? payments : undefined,
      });
      if (res.chargedToRoom) setToRoom({ ipNumber: res.ipNumber ?? "", invoiceId: res.invoice?.id, total: res.invoice?.totalAmount });
      else if (res.invoice) setDone({ id: res.invoice.id, receiptNo: res.invoice.receiptNo, total: res.invoice.totalAmount });
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not dispense."); }
    finally { setBusy(false); }
  }

  function reset() {
    setDone(null); setToRoom(null); setPatient(null); setLines([]); setQ(""); setDisc(0);
    setPayments([]); setPayValid(true); setShortReason(""); setError(null);
    setDirectName(""); setDirectPhone(""); setDirectAddress(""); setDirectError(null);
  }

  if (toRoom) {
    return (
      <div className="mx-auto max-w-md">
        <div className="surface flex flex-col items-center p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--p-blue-soft)] text-[var(--p-blue-deep)]"><Icon name="bed" size={26} /></span>
          <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Charged to the room</h3>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">
            Admitted patient - <span className="font-mono font-semibold text-[var(--p-ink)]">{toRoom.ipNumber}</span>
          </p>
          {toRoom.total && (
            <p className="mt-1 text-[13px] text-[var(--p-muted)]">Added to the tab · <span className="font-mono font-semibold text-[var(--p-ink)]">₹{toRoom.total}</span></p>
          )}
          <p className="mt-4 rounded-lg bg-[var(--p-amber-soft)] px-4 py-2.5 text-left text-[12px] leading-relaxed text-[#8a6414]">
            <b>Do not take money.</b> These medicines are on the patient&apos;s room tab and settle in the
            discharge bill. Nothing is collected here.
          </p>
          <p className="mt-2 text-[12px] text-[var(--p-muted)]">
            Stock decremented FEFO. The prescription is filed against {toRoom.ipNumber} and shows on the patient&apos;s record.
          </p>
          <div className="mt-6 flex w-full flex-col gap-2.5">
            {toRoom.invoiceId && (
              <a
                href={`/pharmacy/print/invoice/${toRoom.invoiceId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm"
              >
                <Icon name="file" size={16} /> View the ward bill
              </a>
            )}
            <PrimaryButton onClick={reset}><Icon name="plus" size={15} /> New sale</PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <div className="surface flex flex-col items-center p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><Icon name="check" size={26} /></span>
          <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Dispensed &amp; Billed</h3>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Receipt <span className="font-mono font-semibold text-[var(--p-ink)]">{done.receiptNo}</span> · ₹{done.total}</p>
          
          <div className="mt-6 flex w-full flex-col gap-2.5">
            {done.id && (
              <a
                href={`/pharmacy/print/invoice/${done.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm"
              >
                <Icon name="file" size={16} /> Print / View Invoice Receipt
              </a>
            )}
            <PrimaryButton onClick={reset}>
              <Icon name="plus" size={15} /> New sale
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Dispense medicines</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Counter sale &amp; direct pill dispensing for walk-in users or prescription queue.</p>
        </div>
        {!patient && (
          <button
            onClick={() => setPatientTab(patientTab === "search" ? "direct" : "search")}
            className="flex items-center gap-2 rounded-lg border border-[var(--p-blue)]/30 bg-[var(--p-blue-soft)] px-4 py-2 text-[12.5px] font-medium text-[var(--p-blue-deep)] transition-colors hover:bg-[var(--p-blue)]/15"
          >
            <Icon name={patientTab === "search" ? "plus" : "search"} size={14} />
            {patientTab === "search" ? "⚡ Direct Pill Sale (Walk-in User)" : "Search Registered Patients"}
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section data-rise className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-3.5">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">1 · Patient</h3>
              {!patient && (
                <div className="flex rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-0.5 text-[12px] font-medium">
                  <button
                    type="button"
                    onClick={() => setPatientTab("search")}
                    className={`rounded-md px-3 py-1 transition-colors ${
                      patientTab === "search"
                        ? "bg-white text-[var(--p-ink)] shadow-sm"
                        : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"
                    }`}
                  >
                    Search Patient
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatientTab("direct")}
                    className={`flex items-center gap-1 rounded-md px-3 py-1 transition-colors ${
                      patientTab === "direct"
                        ? "bg-white text-[var(--p-blue)] font-semibold shadow-sm"
                        : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"
                    }`}
                  >
                    <Icon name="plus" size={12} />
                    Direct Pill Sale
                  </button>
                </div>
              )}
            </div>
            <div className="p-6">
              {!patient ? (
                patientTab === "search" ? (
                  <>
                    <div className="flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
                      <Icon name="search" size={16} />
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or JMH2026OP00123…" className="w-full text-sm outline-none" />
                    </div>
                    {results.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {results.map((p) => (
                          <button key={p.id} onClick={() => { setPatient(p); setQ(""); }} className="surface-hover flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] p-3 text-left">
                            <div><div className="text-[13px] font-medium text-[var(--p-ink)]">{p.fullName}</div><div className="text-[11px] text-[var(--p-muted)]"><span className="tabular">{p.displayId}</span> · {p.phone}</div></div>
                            <Icon name="chevron" size={16} />
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-3.5 py-2 text-[12px] text-[var(--p-muted)]">
                      <span>Selling pills to a walk-in user without pre-registration?</span>
                      <button
                        type="button"
                        onClick={() => setPatientTab("direct")}
                        className="font-medium text-[var(--p-blue)] hover:underline"
                      >
                        Enter User Details →
                      </button>
                    </div>
                  </>
                ) : (
                  <form onSubmit={handleDirectSaleSubmit} className="space-y-4">
                    <div className="rounded-lg bg-[var(--p-blue-soft)]/50 p-3 text-[12px] text-[var(--p-blue-deep)]">
                      Enter the random user&apos;s name, mobile number, and address to proceed with a direct pill sale.
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-[var(--p-muted)]">Customer Name *</label>
                        <input
                          type="text"
                          required
                          value={directName}
                          onChange={(e) => setDirectName(e.target.value)}
                          placeholder="e.g. Ramesh Kumar"
                          className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-3 py-2 text-sm outline-none focus:border-[var(--p-blue)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-[var(--p-muted)]">Mobile Number *</label>
                        <input
                          type="tel"
                          required
                          maxLength={10}
                          value={directPhone}
                          onChange={(e) => setDirectPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                          placeholder="10-digit phone number"
                          className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--p-blue)]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-[var(--p-muted)]">Address / Locality</label>
                      <input
                        type="text"
                        value={directAddress}
                        onChange={(e) => setDirectAddress(e.target.value)}
                        placeholder="Street, door no, or city address"
                        className="mt-1 w-full rounded-lg border border-[var(--p-border)] px-3 py-2 text-sm outline-none focus:border-[var(--p-blue)]"
                      />
                    </div>
                    {directError && (
                      <div className="rounded-lg bg-[var(--p-rose-soft)] p-2.5 text-[12px] text-[var(--p-rose)] font-medium">
                        {directError}
                      </div>
                    )}
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={directBusy}
                        className="flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {directBusy ? <Spinner /> : <Icon name="check" size={15} />}
                        Confirm Customer &amp; Continue
                      </button>
                      <button
                        type="button"
                        onClick={() => setPatientTab("search")}
                        className="text-[12px] text-[var(--p-muted)] hover:underline"
                      >
                        Cancel / Search
                      </button>
                    </div>
                  </form>
                )
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-[var(--p-blue)] bg-[var(--p-blue-soft)] p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-[var(--p-ink)]">{patient.fullName}</span>
                      <span className="rounded bg-[var(--p-blue)]/10 px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--p-blue)]">
                        {patient.displayId}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--p-muted)]">
                      <span>Phone: <b className="text-[var(--p-ink)]">{patient.phone}</b></span>
                    </div>
                  </div>
                  <button onClick={() => setPatient(null)} className="rounded-lg border border-[var(--p-border)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--p-blue)] hover:bg-gray-50">Change</button>
                </div>
              )}
              {/* Read, not decided. The pharmacist never has to remember which
                  patients are upstairs. */}
              {patient && (
                <div className="mt-4">
                  <AdmissionBanner admission={admission} checking={checkingAdm} what="These medicines" />
                </div>
              )}
            </div>
          </section>

          <section data-rise className={`surface overflow-hidden ${patient ? "" : "pointer-events-none opacity-55"}`}>
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">2 · Medicines</h3>
              <span className="badge">{lines.length} added</span>
            </div>
            <div className="p-6">
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
                <Icon name="search" size={15} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search medicines…" className="w-full text-sm outline-none" />
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
                {meds.map((m) => (
                  <button key={m.id} onClick={() => add(m)} disabled={m.inStock === 0}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--p-border)] p-2.5 text-left transition-colors hover:border-[var(--p-blue)] disabled:opacity-40">
                    <div>
                      <div className="rx-name text-[13px] font-medium text-[var(--p-ink)]">{m.name}</div>
                      <div className="text-[11px] text-[var(--p-muted)]">
                        {m.inStock === 0
                          ? "Out of stock"
                          : `${m.inStock} ${m.unit}${m.inStock === 1 ? "" : "s"} in stock${m.packSize > 1 ? ` · ${Math.floor(m.inStock / m.packSize)} × ${m.packLabel || m.packSize}` : ""}`}
                        {m.nearestExpiry && ` · exp ${m.nearestExpiry}`} · GST {m.gstRatePct}%
                      </div>
                    </div>
                    {/* The per-unit price is what the patient pays; the pack
                        MRP under it is the number printed on the box. */}
                    <span className="text-right">
                      <span className="block font-mono text-[12px] font-semibold">{m.unitMrp ? `₹${m.unitMrp}` : "-"}</span>
                      {m.packSize > 1 && m.mrp && (
                        <span className="block font-mono text-[9.5px] text-[var(--p-muted)]">₹{m.mrp}/{m.packLabel || "pack"}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <aside data-rise className="lg:sticky lg:top-24 lg:self-start">
          <div className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--p-ink)]">Bill</p></div>
            <div className="max-h-56 divide-y divide-[var(--p-border)] overflow-y-auto overscroll-contain">
              {lines.length === 0 ? <p className="px-5 py-8 text-center text-[12px] text-[var(--p-muted)]">No medicines added.</p> : lines.map((l) => (
                <div key={l.medicineId} className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="rx-name text-[12px] text-[var(--p-ink)]">{l.name}</div>
                      <div className="text-[10px] text-[var(--p-muted)]">₹{l.mrp}/{l.unit} · GST {l.gst}%</div>
                    </div>
                    {/* SELLING UNIT. Type 10 and the patient gets ten tablets
                        out of a strip of fifteen - never a rounded-up strip.
                        The unit is printed beside the box so there is nothing
                        to infer from context. */}
                    <span className="flex items-center gap-1">
                      <input type="number" min={1} max={l.inStock} value={l.qty}
                        onChange={(e) => setLines((p) => p.map((x) => x.medicineId === l.medicineId ? { ...x, qty: Math.max(1, Math.min(Number(e.target.value), x.inStock)) } : x))}
                        className="w-14 rounded border border-[var(--p-border)] px-1 py-0.5 text-center text-[11px] outline-none" />
                      <span className="w-10 shrink-0 text-[10px] font-semibold text-[var(--p-muted)]">{l.unit}s</span>
                    </span>
                    <button onClick={() => setLines((p) => p.filter((x) => x.medicineId !== l.medicineId))} className="text-[var(--p-rose)]">✕</button>
                  </div>
                  {(l.packSize ?? 1) > 1 && (
                    <div className="mt-1 flex items-center justify-between gap-2 pl-0.5">
                      <span className="text-[10px] text-[var(--p-muted)]">
                        {l.qty} {l.unit}{l.qty === 1 ? "" : "s"}
                        {" = "}
                        {Math.floor(l.qty / (l.packSize ?? 1)) > 0 && `${Math.floor(l.qty / (l.packSize ?? 1))} × ${l.packLabel || l.packSize}`}
                        {Math.floor(l.qty / (l.packSize ?? 1)) > 0 && l.qty % (l.packSize ?? 1) > 0 && " + "}
                        {l.qty % (l.packSize ?? 1) > 0 && `${l.qty % (l.packSize ?? 1)} loose`}
                      </span>
                      {/* Selling whole strips is the common case; loose tablets
                          are the exception. Both are one action away. */}
                      <span className="flex gap-1">
                        <button
                          onClick={() => setLines((p) => p.map((x) => x.medicineId === l.medicineId
                            ? { ...x, qty: Math.max(1, Math.min(x.qty + (x.packSize ?? 1), x.inStock)) } : x))}
                          className="rounded border border-[var(--p-border)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                          +1 {l.packLabel || "pack"}
                        </button>
                        <button
                          onClick={() => setLines((p) => p.map((x) => x.medicineId === l.medicineId
                            ? { ...x, qty: Math.max(1, x.qty - (x.packSize ?? 1)) } : x))}
                          className="rounded border border-[var(--p-border)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                          −1
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t border-[var(--p-border)] p-5">
              <DiscountInput subtotal={subtotal} accent="blue" onChange={(d) => setDisc(d.amount)} />
              {/* THE TILL IS CLOSED FOR AN INPATIENT. Not disabled - absent.
                  A greyed-out payment box still invites the question "can I
                  override this?"; a bill line saying the money is due at
                  discharge does not. */}
              {isInpatient ? (
                <div className="rounded-lg bg-[var(--p-amber-soft)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[#8a6414]">
                  <b>Do not take money.</b> {admission?.ipNumber} is in a bed - this bill is
                  raised against the stay and settles in the discharge bill.
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--p-text)]">
                    <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="h-4 w-4 accent-[var(--p-blue)]" /> Collect payment now
                  </label>
                  {payNow && (
                    <PaymentSection total={total} accent="blue" onChange={(r) => { setPayments(r.payments); setPayValid(r.valid); }} />
                  )}
                </>
              )}
              {lines.length > 0 && (
                <div className="border-t border-[var(--p-border)] pt-3">
                  <DispenseScratchpad
                    lines={lines} discount={disc} onChange={setLines}
                    reason={shortReason} onReasonChange={setShortReason}
                  />
                </div>
              )}

              <div className="space-y-1 border-t border-[var(--p-border)] pt-3 text-[13px]">
                <div className="flex justify-between"><span className="text-[var(--p-muted)]">Subtotal</span><span className="font-mono">₹{subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--p-muted)]">GST</span><span className="font-mono">₹{gst.toFixed(2)}</span></div>
                <div className="flex justify-between pt-1"><span className="font-semibold text-[var(--p-ink)]">Total</span><span className="font-mono text-[15px] font-semibold text-[var(--p-blue)]">₹{total.toFixed(2)}</span></div>
              </div>
            </div>
            {error && <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-3 text-[12px] text-[var(--p-rose)]">{error}</div>}
            <div className="border-t border-[var(--p-border)] p-5">
              <PrimaryButton onClick={submit} disabled={!patient || lines.length === 0 || busy || checkingAdm || (!isInpatient && payNow && !payValid)} full>
                {busy ? <><Spinner /> Dispensing…</>
                  : isInpatient ? <><Icon name="bed" size={15} /> Dispense &amp; charge to room</>
                  : <><Icon name="pill" size={15} /> Dispense &amp; bill</>}
              </PrimaryButton>
              <p className="mt-2 text-center text-[10px] text-[var(--p-muted)]">Medicines are taxable (5%/12%). Batches picked FEFO.</p>
            </div>
          </div>
        </aside>
      </div>
    </PortalScroll>
  );
}
