"use client";

/**
 * THE LAB COUNTER, END TO END.
 *
 * A walk-in arrives with a chit and no file. Before this screen could register
 * them, they were sent to reception to be typed in, then back here to have
 * tests ordered, then to Billing to pay - three queues for one transaction, and
 * the tests that never got billed were always the ones where somebody gave up
 * halfway.
 *
 * So: who (existing record or a name and a mobile), what (the catalogue), and
 * the money - in one submit. The bill is optional, because a test ordered
 * against an admitted patient is settled at discharge and a test on account is
 * billed later, but for the person standing at the window it is the default.
 */

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, SuccessCheck } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PatientStep, draftName, draftPayload, type PatientChoice } from "@/components/portal/labs/patient-step";
import { TestPicker, type CatalogItem } from "@/components/portal/labs/test-picker";
import { ReferrerSelect, useDoctorRoster } from "@/components/portal/labs/referrer-select";
import { BillAside, type Settlement } from "@/components/portal/labs/bill-aside";
import { InvoiceView, type LabInvoice } from "@/components/portal/labs/invoice-view";
import { api, ApiClientError } from "@/lib/api-client";
import { formatAge } from "@/lib/age";
import { formatPhone } from "@/lib/phone";

interface WalkInResult {
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null; dob: string | null; gender: string | null; isNew: boolean };
  tests: { id: string; testName: string }[];
  invoice: LabInvoice | null;
  chargedToRoom: boolean;
}

export default function OrderTestsPage() {
  const [choice, setChoice] = useState<PatientChoice | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** The doctor on the chit in their hand, if there is one. "" = self-referred. */
  const [referrerId, setReferrerId] = useState("");
  const doctors = useDoctorRoster();

  const [billNow, setBillNow] = useState(true);
  const [settlement, setSettlement] = useState<Settlement>({ discountAmount: 0, payments: [], valid: true });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);

  useEffect(() => {
    api.get<{ catalog: CatalogItem[] }>("/labs/catalog")
      .then((r) => setCatalog(r.catalog))
      .catch((e) => setLoadError(e instanceof ApiClientError ? e.message : "Couldn't load the test catalog."));
  }, []);

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const selected = useMemo(() => catalog.filter((c) => picked.has(c.id)), [catalog, picked]);
  const lines = selected.map((c) => ({ id: c.id, label: c.name, amount: Number(c.price) }));

  const patientName = choice ? (choice.kind === "existing" ? choice.patient.fullName : draftName(choice.draft)) : "";
  /**
   * An admitted patient is billed to their stay by the server, whatever this
   * screen says - see labs.service. Leaving "Raise the bill now" switched on
   * for them showed a payment box that took no money and reconciled to
   * nothing, and a technician who filled it in believed they had collected.
   */
  const inpatient = choice?.kind === "existing" ? choice.admission : undefined;
  const canSubmit = !!choice && picked.size > 0 && !busy && (inpatient ? true : !billNow || settlement.valid);

  async function submit() {
    if (!choice || picked.size === 0) return;
    setError(null); setBusy(true);
    try {
      const r = await api.post<WalkInResult>("/labs/walk-in", {
        ...(choice.kind === "existing" ? { patientId: choice.patient.id } : { newPatient: draftPayload(choice.draft) }),
        catalogIds: [...picked],
        referringDoctorId: referrerId || undefined,
        bill: billNow && !inpatient
          ? {
              discountAmount: settlement.discountAmount || undefined,
              payments: settlement.payments.length ? settlement.payments : undefined,
            }
          : undefined,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not place the order.");
    } finally { setBusy(false); }
  }

  function reset() {
    setResult(null); setChoice(null); setPicked(new Set()); setReferrerId("");
    setBillNow(true); setSettlement({ discountAmount: 0, payments: [], valid: true }); setError(null);
  }

  // ── done ──
  if (result) {
    const banner = <PatientBanner result={result} />;
    if (result.invoice) {
      return <InvoiceView invoice={result.invoice} onNew={reset} newLabel="New order" banner={banner} />;
    }
    return (
      <div className="mx-auto max-w-lg">
        {banner}
        <div className="surface mt-4 flex flex-col items-center p-8 text-center">
          <SuccessCheck />
          <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">
            {result.tests.length} test{result.tests.length === 1 ? "" : "s"} ordered
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">
            {result.chargedToRoom
              ? "This patient is admitted, so the tests were billed to their stay and are due at discharge. Do not collect at the counter."
              : "Nothing has been charged yet. The tests are in the queue and show as unbilled until a bill is raised."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <PrimaryButton onClick={reset}><Icon name="plus" size={15} /> Order more</PrimaryButton>
            {!result.chargedToRoom && (
              <a href="/labs/billing" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                <Icon name="rupee" size={15} /> Bill them
              </a>
            )}
            <a href="/labs/queue" className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-border)] px-4 py-2.5 text-sm font-medium text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
              <Icon name="flask" size={15} /> Test queue
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Order lab tests</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">
          No doctor visit needed. A patient who has never been here can be registered on this screen -
          a name and a mobile is enough - and billed in the same action. Prices are snapshotted at order time.
        </p>
      </div>

      {loadError && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">
          <Icon name="alert" size={15} /> <span>{loadError}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <PatientStep value={choice} onChange={setChoice} step="1" />
          <TestPicker
            catalog={catalog} picked={picked} onToggle={toggle}
            step="2" disabled={!choice}
            hint={choice ? `For ${patientName}` : "Choose a patient first"}
          />

          {/* The chit is in their hand right now, and this is the only moment
              anybody will be looking at it. Left blank the report reads
              "Self / walk-in", which is true of plenty of samples and wrong
              for every one that came off somebody's prescription. */}
          <section data-rise className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">3 · Who referred them?</h3>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                Whoever wrote the chit. Prints on the report as Ref. Doctor.
              </p>
            </div>
            <div className="p-6">
              <ReferrerSelect
                doctors={doctors} value={referrerId} onChange={setReferrerId}
                hint="Leave it as self / walk-in if nobody sent them - the report says so rather than naming a doctor who never saw the patient."
              />
            </div>
          </section>
        </div>

        <aside data-rise className="lg:sticky lg:top-6 lg:self-start">
          <BillAside
            title={inpatient ? "Goes on the stay" : billNow ? "Order & bill" : "Order summary"}
            lines={lines}
            emptyText="No tests selected."
            billNow={inpatient ? null : billNow}
            onBillNowChange={setBillNow}
            billNowLabel="Raise the bill now"
            onSettlementChange={setSettlement}
            error={error}
            footnote={
              inpatient
                ? `${inpatient.ipNumber} · ${inpatient.ward} ${inpatient.bedNo}. These tests are added to the running tab for this stay and settle at discharge. Take nothing at the counter.`
                : billNow
                  ? "GST is applied per test from the catalogue, server-side. An admitted patient is billed to their stay instead - the counter takes nothing."
                  : "The tests go to the queue unbilled. Raise the bill from the Billing page whenever the patient settles."
            }
            action={
              <PrimaryButton onClick={submit} disabled={!canSubmit} full>
                {busy ? <><Spinner /> {billNow && !inpatient ? "Ordering & billing…" : "Ordering…"}</> : (
                  <>
                    <Icon name={inpatient ? "bed" : billNow ? "receipt" : "flask"} size={15} />
                    {inpatient ? "Add to the stay" : billNow ? "Order & bill" : "Order"} {picked.size || ""} test{picked.size === 1 ? "" : "s"}
                  </>
                )}
              </PrimaryButton>
            }
          />
        </aside>
      </div>
    </PortalScroll>
  );
}

/**
 * Who this was for - and, when the record was created seconds ago, the Jeeva ID
 * it was given. That number is the only way back to this patient, and the one
 * moment it can be written onto the chit in their hand is now.
 */
function PatientBanner({ result }: { result: WalkInResult }) {
  const p = result.patient;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
      p.isNew ? "border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)]" : "border-[var(--p-border)] bg-white"
    }`}>
      <div>
        <p className="text-[14px] font-semibold text-[var(--p-ink)]">{p.fullName}</p>
        <p className="text-[12px] text-[var(--p-muted)]">
          <span className="tabular font-semibold text-[var(--p-teal-deep)]">{p.displayId}</span> · {formatPhone(p.phone)}
          {formatAge(p) && ` · ${formatAge(p)}`}
        </p>
      </div>
      
      {p.isNew && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--p-teal-deep)]">
          <Icon name="check" size={12} /> Newly registered - give them this ID
        </span>
      )}
    </div>
  );
}
