"use client";

/**
 * ORDER LAB TESTS - the bench's way in. No money changes hands here.
 *
 * A walk-in arrives with a chit and no file. Before this screen could register
 * them, they were sent to reception to be typed in and back again, and plenty
 * of them didn't come back. So: who (existing record, a bed upstairs, or a name
 * and a mobile) and what (the catalogue) - in one submit, and the sample can be
 * taken.
 *
 * THE MONEY IS RECEPTION'S. An outpatient's tests land on reception's Lab
 * billing screen ready to bill; an inpatient's go onto their stay as a bill due
 * at discharge, so the discharge desk sees it even if nobody collects it
 * sooner. The server refuses a bill from a lab login outright.
 */

import { useEffect, useMemo, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, SuccessCheck } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PatientStep, draftName, draftPayload, type PatientChoice } from "@/components/portal/labs/patient-step";
import { TestPicker, type CatalogItem } from "@/components/portal/labs/test-picker";
import { ReferrerSelect, useDoctorRoster } from "@/components/portal/labs/referrer-select";
import { api, ApiClientError } from "@/lib/api-client";
import { formatAge } from "@/lib/age";
import { formatPhone } from "@/lib/phone";
import { DuplicatePatientDialog, type FiledPatient } from "@/components/portal/duplicate-patient-dialog";
import { phoneOnFile, type PhoneOnFile } from "@/lib/patient-duplicates";
import { RepeatConfirmDialog } from "@/components/portal/repeat-confirm-dialog";
import { repeatBlock, type RepeatBlock } from "@/lib/repeat-guard";

type SubmitOpts = { patientId?: string; sharedPhoneReason?: string; confirmRepeat?: boolean };

interface OrderResult {
  patient: { id: string; displayId: string; fullName: string; phone: string; age: number | null; dob: string | null; gender: string | null; isNew: boolean };
  tests: { id: string; testName: string }[];
  /** An inpatient: the tests went onto the stay as a bill due at discharge. */
  chargedToRoom: boolean;
}

export default function OrderTestsPage() {
  const [choice, setChoice] = useState<PatientChoice | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** The doctor on the chit in their hand, if there is one. "" = self-referred. */
  const [referrerId, setReferrerId] = useState("");
  const doctors = useDoctorRoster();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  /** The server's "this mobile is already on file" - see submit. */
  const [dupe, setDupe] = useState<PhoneOnFile | null>(null);
  /** The server's "ordered minutes ago", and the submit it refused. */
  const [repeat, setRepeat] = useState<{ block: RepeatBlock; message: string; opts: SubmitOpts } | null>(null);

  useEffect(() => {
    api.get<{ catalog: CatalogItem[] }>("/labs/catalog")
      .then((r) => setCatalog(r.catalog))
      .catch((e) => setLoadError(e instanceof ApiClientError ? e.message : "Couldn't load the test catalog."));
  }, []);

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const selected = useMemo(() => catalog.filter((c) => picked.has(c.id)), [catalog, picked]);
  const total = selected.reduce((s, c) => s + Number(c.price), 0);

  const patientName = choice ? (choice.kind === "existing" ? choice.patient.fullName : draftName(choice.draft)) : "";
  const inpatient = choice?.kind === "existing" ? choice.admission : undefined;
  const canSubmit = !!choice && picked.size > 0 && !busy;

  /**
   * @param opts  set only from the dialogs: the existing record to order
   *              against instead, why this walk-in is a different person from
   *              those already on the number, or that an order matching one
   *              minutes old really is a new one.
   */
  async function submit(opts: SubmitOpts = {}) {
    if (!choice || picked.size === 0) return;
    setError(null); setBusy(true);
    try {
      // No `bill` - ever. See the note at the top.
      const r = await api.post<OrderResult>("/labs/walk-in", {
        ...(opts.patientId
          ? { patientId: opts.patientId }
          : choice.kind === "existing"
            ? { patientId: choice.patient.id }
            : { newPatient: { ...draftPayload(choice.draft), sharedPhoneReason: opts.sharedPhoneReason } }),
        catalogIds: [...picked],
        referringDoctorId: referrerId || undefined,
        confirmRepeat: opts.confirmRepeat || undefined,
      });
      setDupe(null); setRepeat(null);
      setResult(r);
    } catch (e) {
      // The mobile is already on file, or these tests were ordered minutes
      // ago: either way nothing was registered or ordered.
      const onFile = phoneOnFile(e);
      if (onFile) { setDupe(onFile); return; }
      const again = repeatBlock(e);
      if (again) { setRepeat({ block: again, message: (e as Error).message, opts }); return; }
      setDupe(null); setRepeat(null);
      setError(e instanceof ApiClientError ? e.message : "Could not place the order.");
    } finally { setBusy(false); }
  }

  /**
   * The walk-in was on file after all. The order goes straight through against
   * their record - the tests are picked and nothing else on this screen depends
   * on who the patient is, so there is nothing for the bench to re-check.
   */
  function pickFiled(p: FiledPatient) {
    setDupe(null);
    setChoice({ kind: "existing", patient: p, ...(p.admission ? { admission: { ...p.admission } } : {}) });
    void submit({ patientId: p.id });
  }

  function reset() {
    setResult(null); setChoice(null); setPicked(new Set()); setReferrerId(""); setError(null);
  }

  // ── done ──
  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <PatientBanner result={result} />
        <div className="surface mt-4 flex flex-col items-center p-8 text-center">
          <SuccessCheck />
          <h3 className="mt-4 font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">
            {result.tests.length} test{result.tests.length === 1 ? "" : "s"} ordered
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--p-muted)]">
            {result.chargedToRoom
              ? "This patient is admitted, so the tests went onto their stay as a lab bill due at discharge. Take nothing here - reception or the discharge desk collects it."
              : "Take nothing here. Send the patient to reception to pay - the tests are waiting there, ready to bill."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <PrimaryButton onClick={reset}><Icon name="plus" size={15} /> Order more</PrimaryButton>
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
          No doctor visit needed. A patient who has never been here can be registered on this screen - a name and a mobile
          is enough. Prices are snapshotted at order time. <strong>Payment is taken at reception</strong>, not here.
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
          <div className="surface overflow-hidden">
            <div className="border-b border-[var(--p-border)] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--p-ink)]">
                {inpatient ? "Goes on the stay" : "Order summary"}
              </p>
            </div>
            <div className="max-h-64 divide-y divide-[var(--p-border)] overflow-y-auto">
              {selected.length === 0 ? (
                <p className="px-5 py-8 text-center text-[12px] text-[var(--p-muted)]">No tests selected.</p>
              ) : selected.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <span className="text-[12px] text-[var(--p-text)]">{c.name}</span>
                  <span className="shrink-0 font-mono text-[12px] text-[var(--p-ink)]">₹{Number(c.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-[var(--p-border)] px-5 py-3 text-[13px]">
              <span className="text-[var(--p-muted)]">Price at order</span>
              <span className="font-mono text-[var(--p-ink)]">₹{total.toFixed(2)}</span>
            </div>
            {error && <div className="border-t border-[var(--p-border)] bg-[var(--p-rose-soft)] px-5 py-3 text-[12px] leading-relaxed text-[var(--p-rose)]">{error}</div>}
            <div className="border-t border-[var(--p-border)] p-5">
              <PrimaryButton onClick={() => submit()} disabled={!canSubmit} full>
                {busy ? <><Spinner /> Ordering…</> : (
                  <>
                    <Icon name={inpatient ? "bed" : "flask"} size={15} />
                    Order {picked.size || ""} test{picked.size === 1 ? "" : "s"}
                  </>
                )}
              </PrimaryButton>
              <div className="mt-3 text-center text-[11px] leading-relaxed text-[var(--p-muted)]">
                {inpatient
                  ? `${inpatient.ipNumber} · ${inpatient.ward} ${inpatient.bedNo}. The tests go onto the stay as a lab bill due at discharge. Take nothing here.`
                  : "Take nothing here - reception bills these tests and takes the payment."}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {dupe && choice?.kind === "new" && (
        <DuplicatePatientDialog
          onFile={dupe} phone={choice.draft.phone} newName={draftName(choice.draft)} busy={busy}
          onUse={pickFiled}
          onDifferentPerson={(reason) => submit({ sharedPhoneReason: reason })}
          onClose={() => setDupe(null)}
        />
      )}
      {repeat && (
        <RepeatConfirmDialog
          block={repeat.block} message={repeat.message} busy={busy}
          onConfirm={() => { void submit({ ...repeat.opts, confirmRepeat: true }); }}
          onClose={() => setRepeat(null)}
        />
      )}
    </PortalScroll>
  );
}

/**
 * Who this was for - and, when the record was created seconds ago, the Jeeva ID
 * it was given. That number is the only way back to this patient, and the one
 * moment it can be written onto the chit in their hand is now.
 */
function PatientBanner({ result }: { result: OrderResult }) {
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
