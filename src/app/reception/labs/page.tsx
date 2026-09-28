"use client";

/**
 * LAB BILLING - the one place in the building that takes money for lab tests.
 *
 * The lab bench orders and runs tests and takes no money. Everything it ordered
 * lands here unbilled, and this desk bills it - along with anything the
 * patient's chit asks for that nobody has ordered yet, which is ordered as the
 * bill is raised so the sample can be taken.
 *
 * Three ways in, the same three as the pharmacy counter:
 *
 *   · an OP patient, found by name, Jeeva ID or mobile - with the consultation
 *     their chit came from, whose advised tests are ticked for them;
 *   · an inpatient, picked from the occupied beds - billed ONTO THE STAY, and,
 *     like a ward strip at the pharmacy, either paid here or left due for the
 *     discharge desk;
 *   · a new walk-in, registered from a name and a mobile as the bill is raised.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PatientStep, draftPayload, type LabPatient, type PatientChoice } from "@/components/portal/labs/patient-step";
import { TestPicker, type CatalogItem } from "@/components/portal/labs/test-picker";
import { ReferrerSelect, useDoctorRoster } from "@/components/portal/labs/referrer-select";
import { BillAside, type Settlement } from "@/components/portal/labs/bill-aside";
import { InvoiceView, type LabInvoice } from "@/components/portal/labs/invoice-view";
import { useAdmission } from "@/components/portal/reception/admission-banner";
import { api, ApiClientError } from "@/lib/api-client";
import { formatPhone } from "@/lib/phone";
import { useLive } from "@/lib/realtime/use-live";
import { EVENTS, TOPICS } from "@/lib/realtime/topics";

interface Test { id: string; testName: string; status: string; price: string | null; billed: boolean }
interface Visit { id: string; opNumber: string; doctorName: string; visitDate: string }
/** A test the doctor wrote on the sheet, and what became of it. */
interface Advised {
  id: string; testName: string; catalogId: string | null; price: string | null;
  labTestId: string | null;
  status: "ORDERED" | "DECLINED" | "OUTSTANDING";
  declinedReason: string | null;
}
interface WalkInResult {
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null; dob: string | null; gender: string | null; isNew: boolean };
  tests: { id: string; testName: string }[];
  invoice: LabInvoice | null;
  /** On the stay and nothing taken - due at discharge. */
  chargedToRoom: boolean;
}

const EMPTY_SETTLEMENT: Settlement = { discountAmount: 0, payments: [], valid: true };

/** ?patient=JMH… - the same deep-link contract as every other reception page. */
function PatientFromUrl({ onFound }: { onFound: (p: LabPatient) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const pid = params.get("patient");
    if (!pid) return;
    api.get<{ patient: LabPatient }>(`/reception/patients/${encodeURIComponent(pid)}`)
      .then((r) => onFound(r.patient)).catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function ReceptionLabBillingPage() {
  const [choice, setChoice] = useState<PatientChoice | null>(null);
  const existing = choice?.kind === "existing" ? choice : null;
  const displayId = existing?.patient.displayId ?? null;

  // THE STAY, WHICHEVER TAB THEY WERE FOUND ON. The Inpatient tab carries the
  // admission; a search does not, and a patient searched by name can still be
  // lying in a bed. Their tests go on the stay either way - the server decides
  // that - so the screen has to know too, or it offers a counter receipt for a
  // bill that is really the discharge desk's.
  const { admission: liveAdmission } = useAdmission(existing?.patient.id);
  const stay = existing?.admission ?? (liveAdmission
    ? { admissionId: liveAdmission.id, ipNumber: liveAdmission.ipNumber, ward: liveAdmission.wardName, bedNo: liveAdmission.bedNo }
    : undefined);

  const [unbilled, setUnbilled] = useState<Test[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [pickedTests, setPickedTests] = useState<Set<string>>(new Set());

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [pickedCatalog, setPickedCatalog] = useState<Set<string>>(new Set());

  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitId, setVisitId] = useState("");
  const [advised, setAdvised] = useState<Advised[]>([]);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  /** The doctor on the chit, when no consultation here names one. */
  const [referrerId, setReferrerId] = useState("");
  const doctors = useDoctorRoster();

  const [settlement, setSettlement] = useState<Settlement>(EMPTY_SETTLEMENT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);

  useEffect(() => {
    api.get<{ catalog: CatalogItem[] }>("/labs/catalog")
      .then((r) => setCatalog(r.catalog))
      .catch(() => setCatalog([]));
  }, []);

  // What this patient already owes the lab - usually tests the bench ordered.
  // A brand-new walk-in has nothing by definition.
  useEffect(() => {
    setPickedTests(new Set());
    setUnbilled([]);
    if (!displayId) return;
    let active = true;
    setLoadingTests(true);
    api.get<{ tests: Test[] }>(`/labs/patients/${displayId}`)
      .then((r) => {
        if (!active) return;
        const open = r.tests.filter((t) => !t.billed);
        setUnbilled(open);
        // The bench ordered these for this person and they came here to pay
        // for them - ticked, so the common case is one click.
        setPickedTests(new Set(open.map((t) => t.id)));
      })
      .catch((e) => { if (active) setError(e instanceof ApiClientError ? e.message : "Couldn't load this patient's tests."); })
      .finally(() => { if (active) setLoadingTests(false); });
    return () => { active = false; };
  }, [displayId]);

  // The consultation a chit came from. Not for an inpatient - their tests file
  // to the stay, not to an OP visit.
  useEffect(() => {
    setVisitId("");
    if (!displayId || stay) { setVisits([]); return; }
    api.get<{ visits: Visit[] }>(`/reception/patients/${displayId}/completed-visits`)
      .then((r) => setVisits(r.visits)).catch(() => setVisits([]));
    // `stay` is derived each render; its presence is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayId, !!stay]);

  // WHAT THE DOCTOR ASKED FOR ON THAT VISIT, pre-ticked below so the default is
  // "bill what was actually asked for" rather than retyping it off the chit.
  const loadAdvised = useCallback(() => {
    if (!visitId) { setAdvised([]); return; }
    api.get<{ advised: Advised[] }>(`/reception/advised-labs?appointmentId=${encodeURIComponent(visitId)}`)
      .then((r) => setAdvised(r.advised)).catch(() => setAdvised([]));
  }, [visitId]);
  useEffect(() => { loadAdvised(); }, [loadAdvised]);

  // A second desk ordering one of these must show here, or two people order the
  // same blood draw. Only the advice reloads; the picks below are the user's.
  useLive([TOPICS.RECEPTION], loadAdvised, {
    events: [EVENTS.LAB_ORDERED],
    enabled: !!visitId && !decliningId,
  });

  useEffect(() => {
    const outstanding = advised.filter((a) => a.status === "OUTSTANDING" && a.catalogId);
    if (outstanding.length === 0) return;
    setPickedCatalog((prev) => {
      const next = new Set(prev);
      for (const a of outstanding) if (a.catalogId) next.add(a.catalogId);
      return next;
    });
  }, [advised]);

  const toggleTest = (id: string) =>
    setPickedTests((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleCatalog = (id: string) =>
    setPickedCatalog((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const selectedTests = useMemo(() => unbilled.filter((t) => pickedTests.has(t.id)), [unbilled, pickedTests]);
  const selectedCatalog = useMemo(() => catalog.filter((c) => pickedCatalog.has(c.id)), [catalog, pickedCatalog]);
  const lines = [
    ...selectedTests.map((t) => ({ id: t.id, label: t.testName, amount: Number(t.price ?? 0), note: "ordered by the lab" })),
    ...selectedCatalog.map((c) => ({ id: c.id, label: c.name, amount: Number(c.price), note: "ordered with this bill" })),
  ];

  const canSubmit = !!choice && lines.length > 0 && !busy && settlement.valid;

  // Steps number themselves by what is on screen: the chit only for an OP
  // patient on file, the already-ordered list only for somebody with a record.
  const showChit = !!existing && !stay;
  const unbilledStep = showChit ? "3" : "2";
  const catalogStep = existing ? (showChit ? "4" : "3") : "2";

  /** Take an advised test off the list without ordering it. Reason required. */
  async function decline(id: string) {
    if (declineReason.trim().length < 3) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/reception/advised-labs/${id}/decline`, { reason: declineReason.trim() });
      setDecliningId(null); setDeclineReason("");
      loadAdvised();
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not update that test."); }
    finally { setBusy(false); }
  }

  async function generate() {
    if (!choice || lines.length === 0) return;
    setError(null); setBusy(true);
    try {
      // The advised rows this bill orders, so the doctor's instruction stops
      // showing as outstanding the moment it is acted on.
      const fromAdvised = advised
        .filter((a) => a.status === "OUTSTANDING" && a.catalogId && pickedCatalog.has(a.catalogId))
        .map((a) => ({ advisedLabId: a.id, catalogId: a.catalogId! }));

      const r = await api.post<WalkInResult>("/labs/walk-in", {
        ...(choice.kind === "existing" ? { patientId: choice.patient.id } : { newPatient: draftPayload(choice.draft) }),
        catalogIds: [...pickedCatalog],
        labTestIds: [...pickedTests],
        appointmentId: !stay && visitId ? visitId : undefined,
        // A consultation's own doctor IS the referrer; only a chit with no
        // visit behind it needs one named.
        referringDoctorId: visitId ? undefined : (referrerId || undefined),
        fromAdvised: fromAdvised.length ? fromAdvised : undefined,
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
    setPickedCatalog(new Set()); setVisits([]); setVisitId(""); setAdvised([]);
    setReferrerId(""); setSettlement(EMPTY_SETTLEMENT); setError(null);
  }

  if (result?.invoice) {
    return (
      <PortalScroll>
        <InvoiceView
          invoice={result.invoice} onNew={reset} newLabel="Bill another patient"
          banner={<ResultBanner result={result} />}
        />
      </PortalScroll>
    );
  }

  return (
    <PortalScroll>
      <Suspense fallback={null}>
        <PatientFromUrl onFound={(p) => setChoice({ kind: "existing", patient: p })} />
      </Suspense>

      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Lab billing</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--p-muted)]">
          Tests the lab ordered come up ready to bill. Add anything else on the chit and it goes to the lab as the bill is
          raised. An inpatient&apos;s bill goes on their stay - collect it now, or leave it due at discharge. Diagnostics
          are <strong>GST-exempt</strong> unless the catalogue says otherwise.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <PatientStep value={choice} onChange={setChoice} step="1" />

          {/* ── the chit: which consultation, which doctor, what was advised ── */}
          {showChit && (
            <section data-rise className="surface overflow-hidden">
              <div className="border-b border-[var(--p-border)] px-6 py-4">
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">2 · Where the chit came from</h3>
              </div>
              <div className="space-y-4 p-6">
                {visits.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">
                      Which consultation ordered these? <span className="font-normal normal-case">(optional)</span>
                    </label>
                    <select
                      value={visitId} onChange={(e) => setVisitId(e.target.value)}
                      className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]"
                    >
                      <option value="">Walk-in - no consultation</option>
                      {visits.map((v) => (
                        <option key={v.id} value={v.id}>{v.visitDate} · {v.doctorName} · {v.opNumber}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* A visit carries its own doctor and that one wins - naming a
                    second here would put two on the report's Ref. Doctor line. */}
                {visitId ? (
                  <p className="text-[12px] text-[var(--p-muted)]">
                    Referring doctor:{" "}
                    <span className="font-medium text-[var(--p-ink)]">
                      {visits.find((v) => v.id === visitId)?.doctorName ?? "the consulting doctor"}
                    </span>{" "}
                    - taken from the consultation above.
                  </p>
                ) : (
                  <ReferrerSelect
                    doctors={doctors} value={referrerId} onChange={setReferrerId}
                    hint="Who wrote the chit. Prints on the report as Ref. Doctor - leave it blank and it reads self / walk-in."
                  />
                )}

                {/* WHAT THE DOCTOR ACTUALLY ASKED FOR. The ones the catalogue can
                    price are ticked below; the rest are named so they cannot be
                    quietly lost. */}
                {advised.length > 0 && (
                  <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h4 className="text-[13px] font-semibold text-[var(--p-ink)]">Advised by the doctor on this visit</h4>
                      <span className="text-[12px] text-[var(--p-muted)]">
                        {advised.filter((a) => a.status === "OUTSTANDING").length} still to order
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {advised.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                          <span className="font-medium text-[var(--p-ink)]">{a.testName}</span>
                          {a.status === "ORDERED" && (
                            <span className="rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--p-teal-deep)]">Ordered</span>
                          )}
                          {a.status === "DECLINED" && (
                            <span className="text-[12px] text-[var(--p-muted)]">Not needed - {a.declinedReason}</span>
                          )}
                          {a.status === "OUTSTANDING" && (
                            <>
                              <span className="rounded bg-[var(--p-amber-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[#8a6414]">
                                {!a.catalogId ? "Not in the lab list" : pickedCatalog.has(a.catalogId) ? "Ticked below" : "Not ordered"}
                              </span>
                              <button
                                onClick={() => { setDecliningId(a.id); setDeclineReason(""); }}
                                className="text-[12px] font-medium text-[var(--p-muted)] underline underline-offset-2 hover:text-[var(--p-ink)]">
                                Not needed
                              </button>
                            </>
                          )}
                          {decliningId === a.id && (
                            <span className="flex w-full items-center gap-2 pt-1">
                              <input
                                value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} autoFocus
                                placeholder="Why isn't this being done?"
                                className="flex-1 rounded border border-[var(--p-border)] bg-white px-2 py-1 text-[13px] outline-none focus:border-[var(--p-teal)]" />
                              <button onClick={() => decline(a.id)} disabled={busy || declineReason.trim().length < 3}
                                className="rounded bg-[var(--p-ink)] px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-40">Save</button>
                              <button onClick={() => { setDecliningId(null); setDeclineReason(""); }}
                                className="text-[12px] text-[var(--p-muted)]">Cancel</button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── already ordered, not yet billed ── */}
          {existing && (
            <section data-rise className="surface overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-6 py-4">
                <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{unbilledStep} · Ordered by the lab, not yet billed</h3>
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
                <p className="px-6 py-8 text-center text-[13px] text-[var(--p-muted)]">
                  Nothing waiting to be billed{stay ? " - the lab's orders for a stay are already on its bill" : ""}. Add tests from the catalogue below.
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

          {choice && (
            <TestPicker
              catalog={catalog} picked={pickedCatalog} onToggle={toggleCatalog}
              step={catalogStep} title="Add tests from the catalogue"
              hint="Ordered and billed together - they go straight to the lab queue."
              maxHeight="360px"
            />
          )}
        </div>

        <aside data-rise className="lg:sticky lg:top-6 lg:self-start">
          {/* Keyed on the patient, so a discount or a half-typed tender never
              carries over from the last person at the counter. */}
          <BillAside
            key={existing?.patient.id ?? choice?.kind ?? "none"}
            title={stay ? `Bill on the stay · ${stay.ipNumber}` : "Bill"}
            lines={lines}
            emptyText={choice ? "Nothing on this bill yet." : "Choose an OP patient, an inpatient or a new walk-in."}
            billNow={null}
            onSettlementChange={setSettlement}
            error={error}
            footnote={
              stay
                ? `${stay.ward} ${stay.bedNo}. Collect it now, or untick "Collect payment now" and it stays due for the discharge desk.`
                : pickedCatalog.size > 0
                  ? `${pickedCatalog.size} new test${pickedCatalog.size === 1 ? "" : "s"} will go to the lab as this bill is raised.`
                  : undefined
            }
            action={
              <PrimaryButton onClick={generate} disabled={!canSubmit} full>
                {busy ? <><Spinner /> Generating…</> : <><Icon name="receipt" size={15} /> Generate lab bill</>}
              </PrimaryButton>
            }
          />
        </aside>
      </div>
    </PortalScroll>
  );
}

/** Who was billed, and - for a new record or a stay - what the desk must say. */
function ResultBanner({ result }: { result: WalkInResult }) {
  const p = result.patient;
  return (
    <div className="space-y-2">
      {p.isNew && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--p-teal)]/30 bg-[var(--p-teal-soft)] px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold text-[var(--p-ink)]">{p.fullName}</p>
            <p className="text-[12px] text-[var(--p-muted)]">
              <span className="tabular font-semibold text-[var(--p-teal-deep)]">{p.displayId}</span> · {formatPhone(p.phone)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--p-teal-deep)]">
            <Icon name="check" size={12} /> Newly registered - give them this ID
          </span>
        </div>
      )}
      {result.chargedToRoom && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] px-4 py-3 text-[13px] text-[#8a6414]">
          <Icon name="bed" size={15} />
          <span>On the stay and <b>due at discharge</b> - nothing was collected now. The discharge desk will see it outstanding.</span>
        </div>
      )}
    </div>
  );
}
