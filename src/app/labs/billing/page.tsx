"use client";

/**
 * GENERATE A LAB BILL.
 *
 * Three kinds of person get billed here and the screen has to hold all three:
 *
 *   · a patient whose tests were ordered earlier and are still unbilled;
 *   · a patient on file who has just been handed a chit - tests are chosen
 *     from the catalogue and ordered as the bill is raised;
 *   · somebody with no record at all, who is registered from this screen.
 *
 * The last two used to require a trip to Order tests (and, before that, to
 * reception) and a walk back. They are the same submit now: anything picked
 * from the catalogue is ordered and billed in one call.
 */

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PatientStep, draftName, draftPayload, type PatientChoice } from "@/components/portal/labs/patient-step";
import { TestPicker, type CatalogItem } from "@/components/portal/labs/test-picker";
import { BillAside, type Settlement } from "@/components/portal/labs/bill-aside";
import { InvoiceView, type LabInvoice } from "@/components/portal/labs/invoice-view";
import { api, ApiClientError } from "@/lib/api-client";
import { formatPhone } from "@/lib/phone";

interface Test { id: string; testName: string; status: string; price: string | null; billed: boolean }

interface WalkInResult {
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null; dob: string | null; gender: string | null; isNew: boolean };
  tests: { id: string; testName: string }[];
  invoice: LabInvoice | null;
  chargedToRoom: boolean;
}

export default function LabBillingPage() {
  const [choice, setChoice] = useState<PatientChoice | null>(null);

  const [unbilled, setUnbilled] = useState<Test[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [pickedTests, setPickedTests] = useState<Set<string>>(new Set());

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [pickedCatalog, setPickedCatalog] = useState<Set<string>>(new Set());
  const [addingTests, setAddingTests] = useState(false);

  const [settlement, setSettlement] = useState<Settlement>({ discountAmount: 0, payments: [], valid: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);

  useEffect(() => {
    api.get<{ catalog: CatalogItem[] }>("/labs/catalog")
      .then((r) => setCatalog(r.catalog))
      .catch(() => setCatalog([]));
  }, []);

  // What this patient already owes the lab. A brand-new walk-in has nothing by
  // definition, so the fetch is keyed on the record's id and skipped for a draft.
  const existingId = choice?.kind === "existing" ? choice.patient.displayId : null;
  useEffect(() => {
    setPickedTests(new Set());
    setUnbilled([]);
    if (!existingId) return;
    let active = true;
    setLoadingTests(true);
    api.get<{ tests: Test[] }>(`/labs/patients/${existingId}`)
      .then((r) => { if (active) setUnbilled(r.tests.filter((t) => !t.billed)); })
      .catch((e) => { if (active) setError(e instanceof ApiClientError ? e.message : "Couldn't load this patient's tests."); })
      .finally(() => { if (active) setLoadingTests(false); });
    return () => { active = false; };
  }, [existingId]);

  // A patient with nothing outstanding is here to have something new done -
  // open the catalogue for them rather than showing an empty list and a dead end.
  useEffect(() => {
    if (choice?.kind === "new") setAddingTests(true);
    else if (existingId && !loadingTests && unbilled.length === 0) setAddingTests(true);
  }, [choice?.kind, existingId, loadingTests, unbilled.length]);

  const toggleTest = (id: string) =>
    setPickedTests((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleCatalog = (id: string) =>
    setPickedCatalog((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const selectedTests = useMemo(() => unbilled.filter((t) => pickedTests.has(t.id)), [unbilled, pickedTests]);
  const selectedCatalog = useMemo(() => catalog.filter((c) => pickedCatalog.has(c.id)), [catalog, pickedCatalog]);

  const lines = [
    ...selectedTests.map((t) => ({ id: t.id, label: t.testName, amount: Number(t.price ?? 0), note: "ordered earlier" })),
    ...selectedCatalog.map((c) => ({ id: c.id, label: c.name, amount: Number(c.price), note: "ordered with this bill" })),
  ];

  const patientName = choice ? (choice.kind === "existing" ? choice.patient.fullName : draftName(choice.draft)) : "";
  const canSubmit = !!choice && lines.length > 0 && !busy && settlement.valid;

  async function generate() {
    if (!choice || lines.length === 0) return;
    setError(null); setBusy(true);
    try {
      const r = await api.post<WalkInResult>("/labs/walk-in", {
        ...(choice.kind === "existing" ? { patientId: choice.patient.id } : { newPatient: draftPayload(choice.draft) }),
        catalogIds: [...pickedCatalog],
        labTestIds: [...pickedTests],
        bill: {
          discountAmount: settlement.discountAmount || undefined,
          payments: settlement.payments.length ? settlement.payments : undefined,
        },
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not generate the bill.");
    } finally { setBusy(false); }
  }

  function reset() {
    setResult(null); setChoice(null); setUnbilled([]); setPickedTests(new Set());
    setPickedCatalog(new Set()); setAddingTests(false);
    setSettlement({ discountAmount: 0, payments: [], valid: true }); setError(null);
  }

  if (result?.invoice) {
    return (
      <InvoiceView
        invoice={result.invoice} onNew={reset} newLabel="New bill"
        banner={result.patient.isNew ? <NewPatientBanner patient={result.patient} /> : undefined}
      />
    );
  }

  // Billing an admitted patient's tests never produces a counter receipt - the
  // charge went to their stay. Say so instead of showing a blank invoice.
  if (result?.chargedToRoom) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="surface flex flex-col items-center p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--p-amber-soft)] text-[#8a6414]"><Icon name="bed" size={20} /></span>
          <h3 className="mt-4 font-serif-p text-[20px] font-semibold text-[var(--p-ink)]">Billed to the stay</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">
            {result.patient.fullName} is admitted. The tests were raised on their own lab bill, due at
            discharge - take nothing at the counter.
          </p>
          <PrimaryButton onClick={reset}><Icon name="plus" size={15} /> New bill</PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Generate lab bill</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">
          Bill tests ordered earlier, add new ones from the catalogue, or register a walk-in and bill them
          in one go. GST is applied per test from the catalogue - diagnostic services are <strong>0% (exempt)</strong> by
          default, and your CA can change rates per test.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <PatientStep value={choice} onChange={setChoice} step="1" />

          {/* ── already ordered ── */}
          {choice?.kind === "existing" && (
            <section data-rise className="surface overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-6 py-4">
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">2 · Unbilled tests</h3>
                <div className="flex items-center gap-2">
                  {unbilled.length > 0 && (
                    <button
                      onClick={() => setPickedTests(pickedTests.size === unbilled.length ? new Set() : new Set(unbilled.map((t) => t.id)))}
                      className="text-[12px] font-semibold text-[var(--p-teal)]"
                    >
                      {pickedTests.size === unbilled.length ? "Clear" : "Select all"}
                    </button>
                  )}
                  <span className="badge">{pickedTests.size} selected</span>
                </div>
              </div>
              {loadingTests ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading tests…</div>
              ) : unbilled.length === 0 ? (
                <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">
                  Nothing outstanding for {patientName}. Add tests from the catalogue below.
                </p>
              ) : (
                <div className="divide-y divide-[var(--p-border)]">
                  {unbilled.map((t) => {
                    const on = pickedTests.has(t.id);
                    return (
                      <button key={t.id} onClick={() => toggleTest(t.id)}
                        className={`flex w-full items-center justify-between px-6 py-3.5 text-left transition-colors ${on ? "bg-[var(--p-teal-soft)]/40" : "hover:bg-[var(--p-bg)]"}`}>
                        <div className="flex items-center gap-3">
                          <span className={`flex h-5 w-5 items-center justify-center rounded border ${on ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)]"}`}>
                            {on && <Icon name="check" size={12} />}
                          </span>
                          <div>
                            <div className="text-[13px] font-medium text-[var(--p-ink)]">{t.testName}</div>
                            <div className="text-[11px] text-[var(--p-muted)]">{t.status === "PENDING" ? "Pending result" : "Completed"}</div>
                          </div>
                        </div>
                        <span className="font-mono text-[13px] text-[var(--p-ink)]">₹{t.price ?? "0.00"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ── new tests on this bill ── */}
          {choice && (addingTests ? (
            <TestPicker
              catalog={catalog} picked={pickedCatalog} onToggle={toggleCatalog}
              step={choice.kind === "existing" ? "3" : "2"}
              title="Add tests from the catalogue"
              hint="Ordered and billed together - no separate trip to Order tests."
              maxHeight="360px"
            />
          ) : (
            <button
              data-rise onClick={() => setAddingTests(true)}
              className="surface surface-hover flex w-full items-center justify-center gap-2 px-6 py-4 text-[13px] font-semibold text-[var(--p-teal)]"
            >
              <Icon name="plus" size={14} /> Add a test to this bill
            </button>
          ))}
        </div>

        <aside data-rise className="lg:sticky lg:top-6 lg:self-start">
          <BillAside
            title="Bill"
            lines={lines}
            emptyText={choice ? "Nothing on this bill yet." : "Find or register a patient to start."}
            billNow={null}
            onSettlementChange={setSettlement}
            error={error}
            footnote={
              pickedCatalog.size > 0
                ? `${pickedCatalog.size} new test${pickedCatalog.size === 1 ? "" : "s"} will be ordered as this bill is raised.`
                : undefined
            }
            action={
              <PrimaryButton onClick={generate} disabled={!canSubmit} full>
                {busy ? <><Spinner /> Generating…</> : <><Icon name="receipt" size={15} /> Generate GST bill</>}
              </PrimaryButton>
            }
          />
        </aside>
      </div>
    </PortalScroll>
  );
}

function NewPatientBanner({ patient }: { patient: WalkInResult["patient"] }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)] px-4 py-3">
      <div>
        <p className="text-[14px] font-semibold text-[var(--p-ink)]">{patient.fullName}</p>
        <p className="text-[12px] text-[var(--p-muted)]">
          <span className="tabular font-semibold text-[var(--p-teal-deep)]">{patient.displayId}</span> · {formatPhone(patient.phone)}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--p-teal-deep)]">
        <Icon name="check" size={12} /> Newly registered - give them this ID
      </span>
    </div>
  );
}
