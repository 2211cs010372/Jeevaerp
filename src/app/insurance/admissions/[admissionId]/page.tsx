"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * THE ADMITTED PATIENT'S BILL, as the insurance desk needs it.
 *
 * The reason this screen exists rather than the desk just reading the ward's
 * copy: THE SAME TREATMENT IS NOT THE SAME MONEY TO EVERY PAYER. A dressing is
 * one rate at the counter, another under CGHS, another under a corporate policy.
 * Preparing a claim means restating the stay in the tariff that policy actually
 * settles against - repricing lines, and adding items the ward never billed
 * separately because a self-paying family would not have been charged for them.
 *
 * So editing is the point of the page, not a convenience on it. Two guardrails
 * carried over from the service, because both matter more here than anywhere:
 *
 *   Every reprice writes a note onto the stay with the old figure and the new
 *   one. "The bill was changed after the treatment" is the first thing an
 *   insurer asks, and the answer has to be on the record rather than in
 *   somebody's memory.
 *
 *   Pharmacy lines cannot be touched. They are stock that physically left a
 *   shelf at a price the pharmacy recorded; repricing one here would quietly
 *   decouple the bill from the dispense.
 */

interface Charge {
  id: string; category: string; description: string;
  qty: number; unitPrice: string; gstRatePct: string; amount: string;
  addedBy: string; createdAt: string; fromPharmacy: boolean;
}
interface Sheet {
  admission: {
    id: string; ipNumber: string; status: string; admittedAt: string; reason: string | null;
    wardName: string; bedNo: string; dailyCharge: string;
    payerType: string; insurer: string | null; policyNo: string | null; memberId: string | null;
    patient: { id: string; displayId: string; fullName: string; age: number | null; gender: string | null; phone: string };
    doctor: { name: string; department: string };
  };
  days: number;
  bedTotal: string; nurseTotal: string; chargesTotal: string; grandTotal: string;
  advanceTotal: string; balance: string;
  charges: Charge[];
}

const CATEGORIES = [
  { k: "PROCEDURE", label: "Procedure" },
  { k: "DOCTOR_VISIT", label: "Doctor visit" },
  { k: "NURSING", label: "Nursing" },
  { k: "OXYGEN", label: "Oxygen" },
  { k: "INVESTIGATION", label: "Investigation" },
  { k: "CONSUMABLE", label: "Consumable" },
  { k: "OTHER", label: "Other" },
] as const;
const CAT_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.k, c.label])),
  PHARMACY: "Pharmacy",
};

interface Service {
  id: string; name: string; group: string; category: string;
  price: string; gstRatePct: string; perDay: boolean;
}
const GROUP_LABEL: Record<string, string> = {
  IP_CHARGE: "Inpatient charges",
  SURGERY_OPEN: "Surgery - open",
  SURGERY_LAPAROSCOPIC: "Surgery - laparoscopic",
  OTHER: "Other",
};

/** Some doctors are stored with the honorific on the name and some are not. */
const withDr = (name: string) => (/^dr\.?\s/i.test(name.trim()) ? name.trim() : `Dr. ${name.trim()}`);
const money = (v: string | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const money2 = (v: string | number) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blankLine = { category: "PROCEDURE", description: "", qty: "1", unitPrice: "", gstRatePct: "0" };

export default function InsuranceAdmissionPage() {
  const { admissionId } = useParams<{ admissionId: string }>();
  const [s, setS] = useState<Sheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ ...blankLine });
  const [editId, setEditId] = useState<string | null>(null);
  const [e, setE] = useState({ ...blankLine });

  const [services, setServices] = useState<Service[]>([]);

  const load = useCallback(async () => {
    try { setS(await api.get<Sheet>(`/ipd/admissions/${admissionId}/sheet`)); setError(null); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't load the stay."); }
    finally { setLoading(false); }
  }, [admissionId]);
  useEffect(() => { load(); }, [load]);

  // The hospital's published rate card. Loaded once - a desk adding four lines
  // should not re-fetch the wall board four times.
  useEffect(() => {
    api.get<{ services: Service[] }>("/ipd/services").then((r) => setServices(r.services)).catch(() => {});
  }, []);

  /**
   * Picking a catalogued service fills the line at the COUNTER rate and the
   * right category, then leaves it editable - which is the whole workflow here.
   * The board's price is what a walk-in pays; the claim goes out at whatever the
   * policy settles, and the desk edits down to that in the same box.
   */
  function pickService(id: string) {
    const svc = services.find((x) => x.id === id);
    if (!svc) return;
    setF((prev) => ({
      ...prev,
      description: svc.name,
      category: svc.category,
      unitPrice: String(Number(svc.price)),
      gstRatePct: String(Number(svc.gstRatePct)),
      // A per-day charge defaults to the length of stay so far. Still editable:
      // nobody is on oxygen for every night they are in the bed.
      qty: svc.perDay && s ? String(s.days) : "1",
    }));
  }

  const closed = s ? s.admission.status !== "ADMITTED" : false;

  async function addLine() {
    if (!f.description.trim() || Number(f.unitPrice) < 0) return;
    setBusy(true);
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        category: f.category, description: f.description.trim(),
        qty: Number(f.qty) || 1, unitPrice: Number(f.unitPrice) || 0,
        gstRatePct: Number(f.gstRatePct) || 0,
      });
      setF({ ...blankLine }); setAdding(false); setFlash("Line added to the bill.");
      await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't add the line."); }
    finally { setBusy(false); }
  }

  function startEdit(c: Charge) {
    setEditId(c.id);
    setE({
      category: c.category, description: c.description, qty: String(c.qty),
      unitPrice: String(Number(c.unitPrice)), gstRatePct: String(Number(c.gstRatePct)),
    });
  }

  async function saveEdit() {
    if (!editId) return;
    setBusy(true);
    try {
      await api.patch(`/ipd/charges/${editId}`, {
        category: e.category, description: e.description.trim(),
        qty: Number(e.qty) || 1, unitPrice: Number(e.unitPrice) || 0,
        gstRatePct: Number(e.gstRatePct) || 0,
      });
      setEditId(null); setFlash("Line repriced. The change is on the stay's record.");
      await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't save the change."); }
    finally { setBusy(false); }
  }

  async function removeLine(c: Charge) {
    setBusy(true);
    try {
      await api.del(`/ipd/charges/${c.id}`);
      setFlash("Line removed."); await load();
    } catch (err) { setError(err instanceof ApiClientError ? err.message : "Couldn't remove the line."); }
    finally { setBusy(false); }
  }

  if (loading) return <PortalScroll><div className="flex items-center justify-center gap-2 py-24 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div></PortalScroll>;
  if (!s) return <PortalScroll><div className="surface px-6 py-16 text-center text-[14px] text-[var(--p-rose)]">{error ?? "Not found."}</div></PortalScroll>;

  const a = s.admission;
  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-2.5 py-1.5 text-[13px] text-[var(--p-ink)] outline-none focus:border-[var(--p-blue)]";

  return (
    <PortalScroll>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/pending" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-blue)]">
          <Icon name="chevron" size={14} className="rotate-180" /> To raise
        </Link>
        <a href={`/print/bill/${a.id}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--p-blue-deep)]">
          <Icon name="printer" size={15} /> Detailed bill · print / PDF
        </a>
      </div>

      {/* ── WHO, AND UNDER WHAT POLICY ── */}
      <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-start justify-between gap-5 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">{a.patient.fullName}</h1>
          <p className="mt-1 text-[13.5px] text-[var(--p-muted)]">
            <span className="font-mono">{a.patient.displayId}</span>
            {a.patient.age != null && ` · ${a.patient.age}y`}
            {a.patient.gender && ` · ${a.patient.gender}`}
            {" · "}<span className="font-mono font-semibold text-[var(--p-blue-deep)]">{a.ipNumber}</span>
          </p>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">
            {a.wardName} · {a.bedNo} · day {s.days} · {withDr(a.doctor.name)} ({a.doctor.department})
          </p>
        </div>
        <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] px-4 py-3 text-[13px]">
          {a.payerType === "INSURANCE" ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed to</div>
              <div className="mt-0.5 text-[14px] font-semibold text-[var(--p-ink)]">{a.insurer}</div>
              <div className="font-mono text-[12px] text-[var(--p-muted)]">
                {a.policyNo}{a.memberId && ` · ${a.memberId}`}
              </div>
            </>
          ) : (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Billed to</div>
              <div className="mt-0.5 text-[14px] font-semibold text-[var(--p-ink)]">Self-paying</div>
              <div className="text-[12px] text-[var(--p-muted)]">No policy on this stay</div>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13.5px] font-medium text-[var(--p-cyan-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13.5px] text-[var(--p-rose)]">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* ── FIXED LINES ── the bed and the nursing fee are computed from the
              stay, not stored as rows, so they are shown but not editable here.
              Changing a ward rate mid-stay is a wards-and-beds decision, not a
              claim decision. */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">From the stay</h2>
              <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">Computed from the bed and the days. Not editable here.</p>
            </div>
            <div className="divide-y divide-[var(--p-border)] text-[13.5px]">
              <Fixed k={`${a.wardName} · ${a.bedNo}`} sub={`₹${money(a.dailyCharge)}/day × ${s.days}`} v={s.bedTotal} />
              <Fixed k="Nursing care" sub={`${s.days} day${s.days === 1 ? "" : "s"}`} v={s.nurseTotal} />
            </div>
          </section>

          {/* ── EDITABLE LINES ── */}
          <section data-rise className="surface overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3.5">
              <div>
                <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Charges on this stay</h2>
                <p className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">
                  Reprice a line to the policy&apos;s tariff, or add one the ward didn&apos;t bill.
                </p>
              </div>
              {!closed && (
                <button onClick={() => { setAdding((v) => !v); setEditId(null); }}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-3.5 py-2 text-[13px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                  <Icon name="plus" size={14} /> Add line
                </button>
              )}
            </div>

            {closed && (
              <p className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-2.5 text-[12.5px] text-[#8a5a14]">
                This stay is discharged and its bill is closed. Lines can no longer be changed.
              </p>
            )}

            {adding && !closed && (
              <div className="border-b border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-4">
                {services.length > 0 && (
                  <div className="mb-2.5">
                    <label className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">
                      Pick from the rate card
                    </label>
                    <select className={fld} value="" onChange={(ev) => pickService(ev.target.value)}>
                      <option value="">Choose a service, or type one below…</option>
                      {Object.keys(GROUP_LABEL)
                        .filter((g) => services.some((x) => x.group === g))
                        .map((g) => (
                          <optgroup key={g} label={GROUP_LABEL[g]}>
                            {services.filter((x) => x.group === g).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} — ₹{money(x.price)}{x.perDay ? " / day" : ""}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                    </select>
                    <p className="mt-1 text-[12px] text-[var(--p-muted)]">
                      Fills the counter rate. Change it to whatever this policy actually settles.
                    </p>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_100px_90px_80px]">
                <input className={fld} autoFocus value={f.description} placeholder="Description (e.g. OT charges)"
                  onChange={(ev) => setF({ ...f, description: ev.target.value })} />
                <select className={fld} value={f.category} onChange={(ev) => setF({ ...f, category: ev.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                </select>
                <input className={fld} inputMode="numeric" value={f.unitPrice} placeholder="Rate ₹"
                  onChange={(ev) => setF({ ...f, unitPrice: ev.target.value.replace(/[^\d.]/g, "") })} />
                <input className={fld} inputMode="numeric" value={f.qty} placeholder="Qty"
                  onChange={(ev) => setF({ ...f, qty: ev.target.value.replace(/\D/g, "") })} />
                <button onClick={addLine} disabled={busy || !f.description.trim()}
                  className="rounded-lg bg-[var(--p-blue)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                  {busy ? "…" : "Add"}
                </button>
                </div>
              </div>
            )}

            {s.charges.length === 0 ? (
              <p className="px-5 py-12 text-center text-[13px] text-[var(--p-muted)]">
                Nothing on the tab yet beyond the bed and nursing.
              </p>
            ) : (
              <div className="divide-y divide-[var(--p-border)]">
                {s.charges.map((c) =>
                  editId === c.id ? (
                    <div key={c.id} className="grid gap-2 bg-[var(--p-blue-soft)] px-5 py-4 sm:grid-cols-[1fr_120px_100px_90px_140px]">
                      <input className={fld} value={e.description} onChange={(ev) => setE({ ...e, description: ev.target.value })} />
                      <select className={fld} value={e.category} onChange={(ev) => setE({ ...e, category: ev.target.value })}>
                        {CATEGORIES.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
                      </select>
                      <input className={fld} inputMode="numeric" value={e.unitPrice}
                        onChange={(ev) => setE({ ...e, unitPrice: ev.target.value.replace(/[^\d.]/g, "") })} />
                      <input className={fld} inputMode="numeric" value={e.qty}
                        onChange={(ev) => setE({ ...e, qty: ev.target.value.replace(/\D/g, "") })} />
                      <div className="flex gap-2">
                        <button onClick={saveEdit} disabled={busy}
                          className="flex-1 rounded-lg bg-[var(--p-blue)] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                          {busy ? "…" : "Save"}
                        </button>
                        <button onClick={() => setEditId(null)}
                          className="rounded-lg border border-[var(--p-border)] px-3 py-2 text-[13px] text-[var(--p-text)]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13.5px] font-medium text-[var(--p-ink)]">{c.description}</span>
                          <span className="rounded bg-[var(--p-border)]/40 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--p-muted)]">
                            {CAT_LABEL[c.category] ?? c.category}
                          </span>
                          {c.fromPharmacy && (
                            <span className="rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#8a5a14]">
                              From pharmacy
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                          ₹{money2(c.unitPrice)} × {c.qty} · added by {c.addedBy}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money2(c.amount)}</span>
                        {!closed && !c.fromPharmacy && (
                          <div className="flex gap-1.5">
                            <button onClick={() => { startEdit(c); setAdding(false); }}
                              className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-text)] hover:border-[var(--p-blue)] hover:text-[var(--p-blue)]">
                              Reprice
                            </button>
                            <button onClick={() => removeLine(c)} disabled={busy}
                              className="rounded-lg border border-[var(--p-border)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--p-muted)] hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── WHAT THE CLAIM IS WORTH ── */}
        <div>
          <section data-rise className="surface overflow-hidden xl:sticky xl:top-4">
            <div className="border-b border-[var(--p-border)] px-5 py-3.5">
              <h2 className="text-[14px] font-semibold text-[var(--p-ink)]">Bill so far</h2>
            </div>
            <dl className="divide-y divide-[var(--p-border)] text-[13.5px]">
              <Row k="Bed" v={s.bedTotal} />
              <Row k="Nursing" v={s.nurseTotal} />
              <Row k="Charges" v={s.chargesTotal} />
            </dl>
            <div className="border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[var(--p-muted)]">Total</span>
                <span className="font-mono text-[20px] font-bold text-[var(--p-ink)]">₹{money2(s.grandTotal)}</span>
              </div>
              {Number(s.advanceTotal) > 0 && (
                <div className="mt-1 flex items-center justify-between text-[12.5px] text-[var(--p-muted)]">
                  <span>less advance held</span>
                  <span className="font-mono">−₹{money2(s.advanceTotal)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-[var(--p-border)] px-5 py-4">
              <a href={`/print/bill/${a.id}`} target="_blank" rel="noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--p-blue)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--p-blue-deep)]">
                <Icon name="printer" size={15} /> Detailed bill
              </a>
              <p className="mt-2 text-[12px] leading-relaxed text-[var(--p-muted)]">
                Opens the A4 claim bill, grouped with subtotals and carrying bill no{" "}
                <span className="font-mono">{a.ipNumber}-P</span> until discharge. Print it, or save it as a PDF to attach.
              </p>
            </div>
          </section>
        </div>
      </div>
    </PortalScroll>
  );
}

function Fixed({ k, sub, v }: { k: string; sub: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div>
        <div className="text-[13.5px] font-medium text-[var(--p-ink)]">{k}</div>
        <div className="text-[12px] text-[var(--p-muted)]">{sub}</div>
      </div>
      <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money2(v)}</span>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5">
      <dt className="text-[var(--p-muted)]">{k}</dt>
      <dd className="font-mono text-[var(--p-ink)]">₹{money2(v)}</dd>
    </div>
  );
}
