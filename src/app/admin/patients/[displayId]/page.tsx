"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PrimaryButton, Pill, statusTone } from "@/components/portal/ui/primitives";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

interface Profile {
  id: string; displayId: string; uuid: string; fullName: string;
  firstName: string; middleName: string | null; lastName: string | null;
  dob: string | null; age: number | null; gender: string | null; bloodGroup: string | null;
  maritalStatus: string | null; phone: string; alternatePhone: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null; country: string | null;
  postalCode: string | null; occupation: string | null; nationality: string | null;
  preferredLanguage: string | null; emergencyContactName: string | null;
  emergencyContactRelation: string | null; emergencyContactPhone: string | null;
  allergies: string | null; govtIdNumber: string | null;
  referredByName: string | null; referralSource: string | null;
  isVip: boolean; isActive: boolean; isDeceased: boolean; deceasedAt: string | null;
  remarks: string | null; archived: boolean; archivedAt: string | null;
  createdAt: string | null; updatedAt: string | null;
}
interface Stats {
  visits: number; completedVisits: number; cancelledVisits: number;
  revenue: string; outstanding: string; invoices: number; labTests: number;
  admissions: number; firstVisit: string | null; lastVisit: string | null;
}
interface Visit { id: string; opNumber: string; visitDate: string; time: string; status: string; doctorName: string; department: string; }
interface Bill { id: string; receiptNo: string; source: string; status: string; totalAmount: string; paid: string; createdAt: string; }
interface Lab { id: string; name: string; status: string; createdAt: string; }
interface Detail { profile: Profile; stats: Stats; visits: Visit[]; bills: Bill[]; labTests: Lab[]; }

const BLOODS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const VISIT_LABEL: Record<string, string> = { BOOKED: "Booked", CHECKED_IN: "Checked-in", COMPLETED: "Completed", CANCELLED: "Cancelled" };

export default function AdminPatientDetailPage() {
  const { displayId } = useParams<{ displayId: string }>();
  const router = useRouter();

  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState<Record<string, string | boolean>>({});

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.get<Detail>(`/admin/patients/${displayId}`);
      setD(res); seed(res.profile);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Couldn't load this patient.");
    } finally { setLoading(false); }
  }, [displayId]);

  useEffect(() => { load(); }, [load]);

  function seed(p: Profile) {
    setF({
      firstName: p.firstName ?? "", middleName: p.middleName ?? "", lastName: p.lastName ?? "",
      dob: p.dob ?? "", age: p.age != null ? String(p.age) : "", gender: p.gender ?? "",
      bloodGroup: p.bloodGroup ?? "", maritalStatus: p.maritalStatus ?? "",
      phone: p.phone ?? "", alternatePhone: p.alternatePhone ?? "", email: p.email ?? "",
      address: p.address ?? "", city: p.city ?? "", state: p.state ?? "", country: p.country ?? "",
      postalCode: p.postalCode ?? "", occupation: p.occupation ?? "", nationality: p.nationality ?? "",
      preferredLanguage: p.preferredLanguage ?? "", isVip: p.isVip ?? false, remarks: p.remarks ?? "",
    });
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = { ...f };
      body.age = f.age ? Number(f.age) : undefined;
      for (const k of Object.keys(body)) if (body[k] === "") body[k] = undefined;
      await api.patch(`/admin/patients/${displayId}`, body);
      setEditing(false); setNotice("Details saved."); await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save.");
    } finally { setSaving(false); }
  }

  async function toggleArchive() {
    if (!d) return;
    const next = !d.profile.archived;
    setArchiving(true); setError(null);
    try {
      await api.post(`/admin/patients/${displayId}/archive`, { archived: next });
      setArchiveOpen(false);
      setNotice(next ? "Patient archived. They no longer appear at the desk." : "Patient restored.");
      await load();
    } catch (e) {
      setArchiveOpen(false);
      setError(e instanceof ApiClientError ? e.message : "Could not change the archive state.");
    } finally { setArchiving(false); }
  }

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const set = (k: string) => (v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading patient…</div>;
  if (!d) return <div className="surface p-10 text-center text-[14px] text-[var(--p-muted)]">{error ?? "Patient not found."}</div>;

  const p = d.profile;

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/patients")} className="rounded-lg border border-[var(--p-border)] p-2 text-[var(--p-muted)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">←</button>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--p-teal)] font-serif-p text-[15px] font-semibold text-white">
            {p.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("")}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">{p.fullName}</h1>
              {p.isVip && <span className="badge !text-[11px]">VIP</span>}
              {p.archived && <span className="badge !text-[11px] text-[var(--p-muted)]">Archived</span>}
              {p.isDeceased && <span className="badge !text-[11px] text-[var(--p-rose)]">Deceased</span>}
            </div>
            <p className="mt-0.5 font-mono text-[13px] text-[var(--p-teal)]">{p.displayId}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button
                onClick={() => setArchiveOpen(true)}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-[14px] font-medium ${
                  p.archived
                    ? "border-[var(--p-border)] text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]"
                    : "border-[var(--p-rose)]/30 text-[var(--p-rose)] hover:border-[var(--p-rose)]"
                }`}
              >
                <Icon name="alert" size={14} /> {p.archived ? "Restore" : "Archive"}
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-teal)] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[var(--p-teal-deep)]">
                <Icon name="file" size={14} /> Edit details
              </button>
            </>
          ) : (
            <>
              <button onClick={() => { setEditing(false); seed(p); }} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-[14px] text-[var(--p-text)]">Cancel</button>
              <PrimaryButton onClick={save} disabled={saving}>{saving ? <><Spinner /> Saving…</> : <><Icon name="check" size={14} /> Save</>}</PrimaryButton>
            </>
          )}
        </div>
      </div>

      {error && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">
          <Icon name="alert" size={15} /> <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div data-rise className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--p-teal)]/25 bg-[var(--p-bg)] px-4 py-3 text-[14px] text-[var(--p-teal)]">
          <Icon name="check" size={15} /> <span>{notice}</span>
        </div>
      )}

      {/* THE NUMBERS a manager opens this page for */}
      <div data-rise className="mb-6 grid gap-px overflow-hidden rounded-xl border border-[var(--p-border)] bg-[var(--p-border)] sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Visits" value={String(d.stats.visits)} hint={`${d.stats.completedVisits} completed`} />
        <Stat label="Total billed" value={`₹${d.stats.revenue}`} hint={`${d.stats.invoices} invoice${d.stats.invoices === 1 ? "" : "s"}`} />
        <Stat label="Outstanding" value={`₹${d.stats.outstanding}`} hint={Number(d.stats.outstanding) > 0 ? "unpaid" : "settled"} tone={Number(d.stats.outstanding) > 0 ? "rose" : undefined} />
        <Stat label="First visit" value={d.stats.firstVisit ?? "-"} hint={`Last: ${d.stats.lastVisit ?? "-"}`} />
        <Stat label="Lab tests" value={String(d.stats.labTests)} hint={`${d.stats.admissions} admission${d.stats.admissions === 1 ? "" : "s"}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section data-rise className="surface overflow-hidden">
          <div className="border-b border-[var(--p-border)] px-6 py-4">
            <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">Patient details</h3>
          </div>
          {!editing ? (
            <>
              <div className="grid grid-cols-2 gap-px bg-[var(--p-border)]">
                <D k="First name" v={p.firstName} />
                <D k="Middle name" v={p.middleName ?? "-"} />
                <D k="Last name" v={p.lastName ?? "-"} />
                <D k="Date of birth" v={p.dob ?? "-"} />
                <D k="Age" v={p.age != null ? `${p.age}` : "-"} />
                <D k="Gender" v={cap(p.gender)} />
                <D k="Blood group" v={p.bloodGroup ?? "-"} />
                <D k="Marital status" v={cap(p.maritalStatus)} />
                <D k="Phone" v={p.phone} mono />
                <D k="Alternate" v={p.alternatePhone ?? "-"} mono />
                <D k="Email" v={p.email ?? "-"} />
                <D k="Address" v={p.address ?? "-"} />
                <D k="City" v={p.city ?? "-"} />
                <D k="State" v={p.state ?? "-"} />
                <D k="Country" v={p.country ?? "-"} />
                <D k="PIN" v={p.postalCode ?? "-"} />
                <D k="Occupation" v={p.occupation ?? "-"} />
                <D k="Nationality" v={p.nationality ?? "-"} />
                <D k="Language" v={p.preferredLanguage ?? "-"} />
                <D k="Govt ID" v={p.govtIdNumber ?? "-"} mono />
                <D k="Allergies" v={p.allergies ?? "-"} />
                <D k="Remarks" v={p.remarks ?? "-"} />
                <D k="Emergency contact" v={p.emergencyContactName ?? "-"} />
                <D k="Emergency phone" v={p.emergencyContactPhone ?? "-"} mono />
                <D k="Registered" v={p.createdAt ? p.createdAt.slice(0, 10) : "-"} />
                <D k="Last updated" v={p.updatedAt ? p.updatedAt.slice(0, 10) : "-"} />
              </div>

              {/* ADMIN-ONLY. This is the one screen in the app that shows it. */}
              <div className="border-t border-[var(--p-border)] px-6 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Referral (admin only)</p>
                <div className="mt-2 flex flex-wrap gap-6">
                  <div>
                    <p className="text-[11px] text-[var(--p-muted)]">Referred by</p>
                    <p className="text-[14px] text-[var(--p-ink)]">{p.referredByName ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--p-muted)]">Source</p>
                    <p className="text-[14px] text-[var(--p-ink)]">{p.referralSource ?? "-"}</p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-[var(--p-muted)]">
                  Recorded once at registration and deliberately not editable: it is a snapshot of what
                  was true then, and history that can be rewritten is not history.
                </p>
              </div>
            </>
          ) : (
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <Field label="First name"><input className={fld} value={f.firstName as string} onChange={(e) => set("firstName")(e.target.value)} /></Field>
              <Field label="Middle name"><input className={fld} value={f.middleName as string} onChange={(e) => set("middleName")(e.target.value)} /></Field>
              <Field label="Last name"><input className={fld} value={f.lastName as string} onChange={(e) => set("lastName")(e.target.value)} /></Field>
              <Field label="Date of birth"><input type="date" className={fld} value={f.dob as string} onChange={(e) => set("dob")(e.target.value)} /></Field>
              <Field label="Age"><input className={fld} value={f.age as string} onChange={(e) => set("age")(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
              <Field label="Gender">
                <select className={fld} value={f.gender as string} onChange={(e) => set("gender")(e.target.value)}>
                  <option value="">-</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Blood group">
                <select className={fld} value={f.bloodGroup as string} onChange={(e) => set("bloodGroup")(e.target.value)}>
                  <option value="">-</option>{BLOODS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Marital status">
                <select className={fld} value={f.maritalStatus as string} onChange={(e) => set("maritalStatus")(e.target.value)}>
                  <option value="">-</option><option value="SINGLE">Single</option><option value="MARRIED">Married</option>
                  <option value="DIVORCED">Divorced</option><option value="WIDOWED">Widowed</option><option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Phone"><input className={fld} value={f.phone as string} onChange={(e) => set("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
              <Field label="Alternate phone"><input className={fld} value={f.alternatePhone as string} onChange={(e) => set("alternatePhone")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
              <Field label="Email"><input className={fld} value={f.email as string} onChange={(e) => set("email")(e.target.value)} /></Field>
              <Field label="Address" span><input className={fld} value={f.address as string} onChange={(e) => set("address")(e.target.value)} /></Field>
              <Field label="City"><input className={fld} value={f.city as string} onChange={(e) => set("city")(e.target.value)} /></Field>
              <Field label="State"><input className={fld} value={f.state as string} onChange={(e) => set("state")(e.target.value)} /></Field>
              <Field label="Country"><input className={fld} value={f.country as string} onChange={(e) => set("country")(e.target.value)} /></Field>
              <Field label="PIN"><input className={fld} value={f.postalCode as string} onChange={(e) => set("postalCode")(e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
              <Field label="Occupation"><input className={fld} value={f.occupation as string} onChange={(e) => set("occupation")(e.target.value)} /></Field>
              <Field label="Nationality"><input className={fld} value={f.nationality as string} onChange={(e) => set("nationality")(e.target.value)} /></Field>
              <Field label="Language"><input className={fld} value={f.preferredLanguage as string} onChange={(e) => set("preferredLanguage")(e.target.value)} /></Field>
              <Field label="Remarks" span><input className={fld} value={f.remarks as string} onChange={(e) => set("remarks")(e.target.value)} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-[14px] text-[var(--p-text)]">
                <input type="checkbox" checked={f.isVip as boolean} onChange={(e) => set("isVip")(e.target.checked)} className="h-4 w-4 accent-[var(--p-teal)]" /> VIP patient
              </label>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <Panel title="Visits" count={d.visits.length}>
            {d.visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 px-6 py-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[var(--p-ink)]">{v.doctorName}</div>
                  <div className="text-[12px] text-[var(--p-muted)]"><span className="font-mono">{v.visitDate}</span> · {v.time} · {v.department}</div>
                </div>
                <Pill tone={statusTone(VISIT_LABEL[v.status] ?? v.status)}>{VISIT_LABEL[v.status] ?? v.status}</Pill>
              </div>
            ))}
          </Panel>

          <Panel title="Bills" count={d.bills.length}>
            {d.bills.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 px-6 py-3">
                <div className="min-w-0">
                  <div className="font-mono text-[13px] text-[var(--p-ink)]">{b.receiptNo}</div>
                  <div className="text-[12px] text-[var(--p-muted)]">{b.source} · paid ₹{b.paid}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="font-mono text-[13px] text-[var(--p-ink)]">₹{b.totalAmount}</div>
                    <div className="text-[11px] text-[var(--p-muted)]">{b.status}</div>
                  </div>
                  <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-[var(--p-border)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-teal)] hover:border-[var(--p-teal)]">Print</a>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Lab tests" count={d.labTests.length}>
            {d.labTests.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 px-6 py-3">
                <div className="text-[14px] text-[var(--p-ink)]">{l.name}</div>
                <div className="text-[12px] text-[var(--p-muted)]">{l.status}</div>
              </div>
            ))}
          </Panel>
        </div>
      </div>

      {archiveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-md bg-white">
            <div className="border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">
                {p.archived ? "Restore this patient?" : "Archive this patient?"}
              </h3>
            </div>
            <div className="space-y-3 p-6 text-[13px] leading-relaxed text-[var(--p-text)]">
              {p.archived ? (
                <p><strong>{p.fullName}</strong> ({p.displayId}) will appear at reception and in search again.</p>
              ) : (
                <>
                  <p><strong>{p.fullName}</strong> ({p.displayId}) will stop appearing at reception, in search and on this register.</p>
                  <p className="rounded-lg bg-[var(--p-amber-soft)] px-3 py-2 text-[12px] text-[#8a6414]">
                    Nothing is deleted. Their {d.stats.visits} visit{d.stats.visits === 1 ? "" : "s"}, {d.stats.invoices} invoice
                    {d.stats.invoices === 1 ? "" : "s"} and every case sheet stay exactly where they are, because a bill is a tax
                    document and a case sheet is a medico-legal record. You can restore them from this page at any time.
                  </p>
                  <p className="text-[12px] text-[var(--p-muted)]">
                    If this is the same person registered twice, use the duplicate merge at reception instead. Archiving
                    leaves their history stranded on a hidden record.
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--p-border)] p-5">
              <button onClick={() => setArchiveOpen(false)} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-text)]">Cancel</button>
              <button
                onClick={toggleArchive}
                disabled={archiving}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
                  p.archived ? "bg-[var(--p-teal)] hover:bg-[var(--p-teal-deep)]" : "bg-[var(--p-rose)] hover:opacity-90"
                }`}
              >
                {archiving ? <><Spinner /> Working…</> : <>{p.archived ? "Restore patient" : "Archive patient"}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}

function cap(v: string | null) { return v ? v.charAt(0) + v.slice(1).toLowerCase() : "-"; }

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "rose" }) {
  return (
    <div className="bg-white px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</p>
      <p className={`mt-1 font-mono text-[20px] font-semibold ${tone === "rose" ? "text-[var(--p-rose)]" : "text-[var(--p-ink)]"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--p-muted)]">{hint}</p>}
    </div>
  );
}

function D({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="bg-white px-6 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{k}</p>
      <p className={`mt-0.5 text-[14px] text-[var(--p-ink)] ${mono ? "font-mono text-[13px]" : ""}`}>{v}</p>
    </div>
  );
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section data-rise className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
        <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">{title}</h3>
        <span className="badge">{count}</span>
      </div>
      {count === 0
        ? <p className="px-6 py-8 text-center text-[13px] text-[var(--p-muted)]">Nothing yet.</p>
        : <div className="max-h-64 divide-y divide-[var(--p-border)] overflow-y-auto overscroll-contain">{children}</div>}
    </section>
  );
}
