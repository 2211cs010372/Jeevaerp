"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { localDateISO } from "@/lib/date";
import {
  Calendar, FileText, FlaskConical, Receipt, User, LogOut, Plus, Download,
  ArrowRight, Activity, Stethoscope, MapPin, Phone, Clock, CheckCircle2,
  FolderOpen, Eye,
} from "lucide-react";

/* ── types ─────────────────────────────────────────────────────────────── */
interface Profile {
  displayId: string; fullName: string; dob: string | null; age: number | null;
  gender: string | null; bloodGroup: string | null; maritalStatus: string | null;
  phone: string; alternatePhone: string | null; email: string | null;
  address: string | null; city: string | null; state: string | null;
  country: string | null; postalCode: string | null; occupation: string | null;
  nationality: string | null; preferredLanguage: string | null; memberSince: string;
}
interface Appt { opNumber: string; visitDate: string; time: string; status: string; doctorName: string; department: string; price: string; }
interface Rx { id: string; appointmentId: string | null; fileUrl: string | null; fileName: string | null; mimeType: string | null; title: string | null; createdAt: string; appointment: { opNumber: string; visitDate: string; doctorName: string } | null; }
interface Lab { id: string; testName: string; status: string; reportReady: boolean; reportUrl: string | null; date: string; doctorName: string | null; }
interface Bill { id: string; receiptNo: string; source: string; status: string; total: string; paid: string; balance: string; date: string; }
type Bundle = { profile: Profile; appointments: Appt[]; prescriptions: Rx[]; labTests: Lab[]; bills: Bill[] };
type DocKind = "prescription" | "lab" | "opd" | "invoice";
// `file` docs are stored files (open the PDF, offer Save); the rest are live
// print views (open the sheet, which has its own Print / Save PDF button).
type Doc = { key: string; kind: DocKind; title: string; sub: string; date: string; url: string; file: boolean };

type Tab = "overview" | "appointments" | "prescriptions" | "labs" | "documents" | "bills" | "profile";
const TABS: { id: Tab; label: string; icon: typeof Calendar }[] = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "appointments", label: "Appointments", icon: Calendar },
  { id: "prescriptions", label: "Prescriptions", icon: FileText },
  { id: "labs", label: "Lab reports", icon: FlaskConical },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "bills", label: "Bills", icon: Receipt },
  { id: "profile", label: "Profile", icon: User },
];

const DOC_META: Record<DocKind, { label: string; icon: typeof Calendar; soft: string; deep: string }> = {
  prescription: { label: "Prescription", icon: FileText, soft: "--p-teal-soft", deep: "--p-teal-deep" },
  opd: { label: "OPD sheet", icon: Stethoscope, soft: "--p-teal-soft", deep: "--p-teal-deep" },
  lab: { label: "Lab report", icon: FlaskConical, soft: "--p-cyan-soft", deep: "--p-cyan-deep" },
  invoice: { label: "Invoice", icon: Receipt, soft: "--p-amber-soft", deep: "--p-amber" },
};

const STATUS_LABEL: Record<string, string> = { BOOKED: "Booked", CHECKED_IN: "Checked-in", COMPLETED: "Completed", CANCELLED: "Cancelled", PENDING: "Pending", IN_PROGRESS: "In progress", REPORTED: "Reported", PAID: "Paid", PARTIALLY_PAID: "Part-paid" };
const SRC_LABEL: Record<string, string> = { CONSULTATION: "Consultation", LAB: "Laboratory", PHARMACY: "Pharmacy", IPD: "Inpatient", OTHER: "Other" };
const inr = (v: string | number) => "₹" + Number(v).toLocaleString("en-IN");
const prettyDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const cap = (v: string | null) => (v ? v.charAt(0) + v.slice(1).toLowerCase() : "-");

export default function PatientPortalPage() {
  const [data, setData] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phone: "", alternatePhone: "", email: "", address: "", city: "", state: "", postalCode: "" });

  const load = () => api.get<Bundle>("/portal/profile").then((r) => {
    setData(r);
    setForm({ phone: r.profile.phone ?? "", alternatePhone: r.profile.alternatePhone ?? "", email: r.profile.email ?? "", address: r.profile.address ?? "", city: r.profile.city ?? "", state: r.profile.state ?? "", postalCode: r.profile.postalCode ?? "" });
  });

  useEffect(() => { load().catch(() => setError("Couldn't load your portal. Please sign in again.")).finally(() => setLoading(false)); }, []);

  async function saveContact() {
    setSaving(true); setError(null);
    try { await api.patch("/portal/profile/contact", form); await load(); setEditing(false); }
    catch { setError("Couldn't save your details. Please try again."); }
    finally { setSaving(false); }
  }
  async function logout() { try { await api.post("/auth/logout"); } catch { /* ignore */ } window.location.assign("/portal/login"); }

  const today = localDateISO();
  const upcoming = useMemo(() => (data?.appointments ?? []).filter((a) => a.visitDate >= today && (a.status === "BOOKED" || a.status === "CHECKED_IN")).sort((a, b) => a.visitDate.localeCompare(b.visitDate)), [data, today]);
  const pendingBalance = useMemo(() => (data?.bills ?? []).reduce((s, b) => s + Number(b.balance), 0), [data]);
  const reportsReady = (data?.labTests ?? []).filter((l) => l.reportReady).length;

  // Every document the patient has, in one list: scanned prescriptions and lab
  // reports (stored files), plus the live OPD case sheets (typed prescriptions)
  // and bills - each of those opens the same printable sheet the desk uses.
  const documents = useMemo<Doc[]>(() => {
    if (!data) return [];
    const docs: Doc[] = [];
    for (const r of data.prescriptions) {
      const sub = r.appointment ? `${r.appointment.doctorName} · ${prettyDate(r.appointment.visitDate)}` : new Date(r.createdAt).toLocaleDateString("en-IN");
      const date = r.appointment?.visitDate ?? r.createdAt.slice(0, 10);
      if (r.fileUrl) {
        docs.push({ key: `rx-${r.id}`, kind: "prescription", title: r.title || r.fileName || "Prescription", sub, date, url: r.fileUrl, file: true });
      } else if (r.appointmentId) {
        docs.push({ key: `opd-${r.id}`, kind: "opd", title: r.title || "OPD prescription sheet", sub, date, url: `/print/opd/${r.appointmentId}`, file: false });
      }
    }
    for (const l of data.labTests) {
      if (l.reportUrl) docs.push({ key: `lab-${l.id}`, kind: "lab", title: `${l.testName} - report`, sub: `${l.doctorName ? `${l.doctorName} · ` : ""}${prettyDate(l.date)}`, date: l.date, url: l.reportUrl, file: true });
    }
    for (const b of data.bills) {
      docs.push({ key: `inv-${b.id}`, kind: "invoice", title: `Bill ${b.receiptNo}`, sub: `${SRC_LABEL[b.source] ?? b.source} · ${prettyDate(b.date)}`, date: b.date, url: `/print/invoice/${b.id}`, file: false });
    }
    return docs.sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  if (loading) return <Screen>Loading your portal…</Screen>;
  if (error || !data) return (
    <Screen>
      <p className="text-[14px] text-[var(--p-muted)]">{error ?? "Portal unavailable."}</p>
      <Link href="/portal/login" className="mt-4 rounded-lg bg-[var(--p-teal)] px-5 py-2.5 text-[13px] font-semibold text-white">Sign in</Link>
    </Screen>
  );

  const p = data.profile;
  const initials = p.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="portal min-h-screen pb-16 pt-[116px]" data-portal="admin">
      <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
        {/* ── patient header ── */}
        <div className="surface flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[var(--p-teal)] font-serif-p text-[20px] font-bold text-white">{initials}</div>
            <div>
              <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">{p.fullName}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-[var(--p-muted)]">
                <span className="font-mono font-semibold text-[var(--p-teal)]">{p.displayId}</span>
                <span aria-hidden>·</span>
                <span>{[p.age != null ? `${p.age}y` : null, cap(p.gender), p.bloodGroup].filter(Boolean).join(" · ")}</span>
                <span aria-hidden>·</span>
                <span>Patient since {prettyDate(p.memberSince)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/book" className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white">
              <Plus size={15} /> Book appointment
            </Link>
            <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border-strong)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--p-text)] transition-colors hover:border-[var(--p-rose)] hover:text-[var(--p-rose)]">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>

        {/* ── tabs ── */}
        <div className="mt-5 flex gap-1 overflow-x-auto rounded-xl border border-[var(--p-border)] bg-[var(--p-surface)] p-1 shadow-[var(--p-shadow-sm)]">
          {TABS.map((t) => {
            const badge = t.id === "appointments" ? data.appointments.length : t.id === "prescriptions" ? data.prescriptions.length : t.id === "labs" ? data.labTests.length : t.id === "documents" ? documents.length : t.id === "bills" ? data.bills.length : null;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${tab === t.id ? "bg-[var(--p-teal)] text-white" : "text-[var(--p-muted)] hover:bg-[var(--p-bg)] hover:text-[var(--p-ink)]"}`}>
                <t.icon size={15} /> {t.label}
                {badge != null && badge > 0 && <span className={`rounded-full px-1.5 text-[10.5px] font-bold ${tab === t.id ? "bg-white/25" : "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"}`}>{badge}</span>}
              </button>
            );
          })}
        </div>

        {/* ── content ── */}
        <div className="mt-5">
          {tab === "overview" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat icon={Calendar} tint="teal" label="Next appointment" value={upcoming[0] ? prettyDate(upcoming[0].visitDate) : "None booked"} sub={upcoming[0] ? `${upcoming[0].doctorName} · ${upcoming[0].time}` : "Book your next visit"} />
                <Stat icon={Stethoscope} tint="cyan" label="Total visits" value={String(data.appointments.length)} sub={`${data.appointments.filter((a) => a.status === "COMPLETED").length} completed`} />
                <Stat icon={FlaskConical} tint="amber" label="Lab reports" value={String(reportsReady)} sub={`${data.labTests.length} tests on record`} />
                <Stat icon={Receipt} tint={pendingBalance > 0 ? "rose" : "teal"} label="Pending balance" value={inr(pendingBalance)} sub={pendingBalance > 0 ? "amount due" : "all settled"} />
              </div>

              {upcoming[0] && (
                <div className="surface overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="flex items-center gap-4">
                      <span className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><Calendar size={22} /></span>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Your next appointment</p>
                        <p className="mt-0.5 text-[15px] font-semibold text-[var(--p-ink)]">{upcoming[0].doctorName} · {upcoming[0].department}</p>
                        <p className="text-[12.5px] text-[var(--p-muted)]"><span className="font-mono">{prettyDate(upcoming[0].visitDate)}</span> at {upcoming[0].time} · OP {upcoming[0].opNumber}</p>
                      </div>
                    </div>
                    <Chip status={upcoming[0].status} />
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-3">
                <QuickAction href="/book" icon={Plus} title="Book a visit" desc="Pick a doctor and time" />
                <button onClick={() => setTab("documents")} className="text-left"><QuickInner icon={FolderOpen} title="View documents" desc={documents.length > 0 ? `${documents.length} document${documents.length === 1 ? "" : "s"} on record` : "No documents yet"} /></button>
                <button onClick={() => setTab("bills")} className="text-left"><QuickInner icon={Receipt} title="View bills" desc={pendingBalance > 0 ? `${inr(pendingBalance)} due` : "All settled"} /></button>
              </div>
            </div>
          )}

          {tab === "appointments" && (
            <SectionCard title="Appointments" count={data.appointments.length} empty={data.appointments.length === 0} emptyText="No appointments yet. Book your first visit.">
              {data.appointments.map((a) => (
                <Row key={a.opNumber}
                  lead={<span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><Stethoscope size={18} /></span>}
                  title={a.doctorName}
                  sub={<>{a.department} · <span className="font-mono">{prettyDate(a.visitDate)}</span> · {a.time} · <span className="font-mono">{a.opNumber}</span></>}
                  right={<div className="text-right"><Chip status={a.status} /><p className="mt-1 font-mono text-[12px] text-[var(--p-muted)]">{inr(a.price)}</p></div>} />
              ))}
            </SectionCard>
          )}

          {tab === "prescriptions" && (
            <SectionCard title="Prescriptions" count={data.prescriptions.length} empty={data.prescriptions.length === 0} emptyText="No prescriptions yet. They appear here after a consultation.">
              {data.prescriptions.map((r) => (
                <Row key={r.id}
                  lead={<span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><FileText size={18} /></span>}
                  title={r.title || r.fileName || "OPD prescription"}
                  sub={r.appointment ? <>{r.appointment.doctorName} · <span className="font-mono">{prettyDate(r.appointment.visitDate)}</span></> : new Date(r.createdAt).toLocaleDateString("en-IN")}
                  right={r.fileUrl ? (
                    <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" download className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90"><Download size={13} /> Download</a>
                  ) : r.appointmentId ? (
                    <a href={`/print/opd/${r.appointmentId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90"><Eye size={13} /> View OPD sheet</a>
                  ) : (
                    <span className="rounded-lg bg-[var(--p-teal-soft)] px-3.5 py-2 text-[12px] font-semibold text-[var(--p-teal-deep)]">On your visit record</span>
                  )} />
              ))}
            </SectionCard>
          )}

          {tab === "labs" && (
            <SectionCard title="Lab reports" count={data.labTests.length} empty={data.labTests.length === 0} emptyText="No lab tests on record yet.">
              {data.labTests.map((l) => (
                <Row key={l.id}
                  lead={<span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]"><FlaskConical size={18} /></span>}
                  title={l.testName}
                  sub={<>{l.doctorName ? `${l.doctorName} · ` : ""}<span className="font-mono">{prettyDate(l.date)}</span></>}
                  right={<div className="flex items-center gap-2">
                    <Chip status={l.status} />
                    {l.reportUrl ? (
                      <a href={l.reportUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-cyan)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90"><Eye size={13} /> View report</a>
                    ) : l.reportReady && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[var(--p-cyan-soft)] px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--p-cyan-deep)]"><CheckCircle2 size={13} /> Report ready</span>
                    )}
                  </div>} />
              ))}
            </SectionCard>
          )}

          {tab === "documents" && (
            <SectionCard title="Documents" count={documents.length} empty={documents.length === 0} emptyText="No documents yet. Prescriptions, lab reports, OPD sheets and bills appear here as they're added to your record.">
              {documents.map((d) => {
                const m = DOC_META[d.kind];
                return (
                  <Row key={d.key}
                    lead={<span className="grid h-10 w-10 place-items-center rounded-lg" style={{ background: `var(${m.soft})`, color: `var(${m.deep})` }}><m.icon size={18} /></span>}
                    title={d.title}
                    sub={<><span className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ background: `var(${m.soft})`, color: `var(${m.deep})` }}>{m.label}</span> <span className="text-[var(--p-muted)]">{d.sub}</span></>}
                    right={<div className="flex items-center gap-2">
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border-strong)] px-3.5 py-2 text-[12px] font-semibold text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]"><Eye size={13} /> {d.file ? "View" : "Open"}</a>
                      {d.file && <a href={d.url} download className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--p-teal)] px-3.5 py-2 text-[12px] font-semibold text-white hover:opacity-90"><Download size={13} /> Save</a>}
                    </div>} />
                );
              })}
            </SectionCard>
          )}

          {tab === "bills" && (
            <SectionCard title="Bills" count={data.bills.length} empty={data.bills.length === 0} emptyText="No bills yet."
              header={pendingBalance > 0 ? <span className="rounded-lg bg-[var(--p-rose-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-rose)]">{inr(pendingBalance)} due</span> : <span className="rounded-lg bg-[var(--p-teal-soft)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal-deep)]">All settled</span>}>
              {data.bills.map((b) => (
                <Row key={b.receiptNo}
                  lead={<span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><Receipt size={18} /></span>}
                  title={<><span className="font-mono">{b.receiptNo}</span> · {SRC_LABEL[b.source] ?? b.source}</>}
                  sub={<><span className="font-mono">{prettyDate(b.date)}</span> · Paid {inr(b.paid)} of {inr(b.total)}</>}
                  right={<div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-[15px] font-bold text-[var(--p-ink)]">{inr(b.total)}</p>
                      {Number(b.balance) > 0 ? <p className="font-mono text-[12px] font-semibold text-[var(--p-rose)]">{inr(b.balance)} due</p> : <Chip status="PAID" />}
                    </div>
                    <a href={`/print/invoice/${b.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--p-border-strong)] px-3.5 py-2 text-[12px] font-semibold text-[var(--p-teal)] transition-colors hover:border-[var(--p-teal)]"><Eye size={13} /> View bill</a>
                  </div>} />
              ))}
            </SectionCard>
          )}

          {tab === "profile" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="surface p-6">
                <h2 className="mb-4 font-serif-p text-[16px] font-semibold text-[var(--p-ink)]">Personal details</h2>
                <Grid>
                  <Field k="Full name" v={p.fullName} />
                  <Field k="Date of birth" v={p.dob ? prettyDate(p.dob) : "-"} />
                  <Field k="Age" v={p.age != null ? `${p.age} years` : "-"} />
                  <Field k="Gender" v={cap(p.gender)} />
                  <Field k="Blood group" v={p.bloodGroup ?? "-"} />
                  <Field k="Marital status" v={cap(p.maritalStatus)} />
                  <Field k="Occupation" v={p.occupation ?? "-"} />
                  <Field k="Language" v={p.preferredLanguage ?? "-"} />
                </Grid>
              </div>

              <div className="surface p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-serif-p text-[16px] font-semibold text-[var(--p-ink)]">Contact</h2>
                  {!editing ? (
                    <button onClick={() => setEditing(true)} className="rounded-lg border border-[var(--p-border-strong)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-teal)] hover:border-[var(--p-teal)]">Edit</button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setEditing(false)} className="rounded-lg border border-[var(--p-border-strong)] px-3 py-1.5 text-[12px] text-[var(--p-muted)]">Cancel</button>
                      <button onClick={saveContact} disabled={saving} className="btn-primary rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
                    </div>
                  )}
                </div>
                {!editing ? (
                  <Grid>
                    <Field k="Phone" v={p.phone} icon={Phone} />
                    <Field k="Alternate" v={p.alternatePhone ?? "-"} />
                    <Field k="Email" v={p.email ?? "-"} span />
                    <Field k="Address" v={p.address ?? "-"} span icon={MapPin} />
                    <Field k="City" v={p.city ?? "-"} />
                    <Field k="State" v={p.state ?? "-"} />
                    <Field k="PIN" v={p.postalCode ?? "-"} />
                    <Field k="Country" v={p.country ?? "-"} />
                  </Grid>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <EditField k="Phone" v={form.phone} onChange={(v) => setForm({ ...form, phone: v.replace(/\D/g, "").slice(0, 10) })} />
                    <EditField k="Alternate" v={form.alternatePhone} onChange={(v) => setForm({ ...form, alternatePhone: v.replace(/\D/g, "").slice(0, 10) })} />
                    <EditField k="Email" v={form.email} onChange={(v) => setForm({ ...form, email: v })} span />
                    <EditField k="Address" v={form.address} onChange={(v) => setForm({ ...form, address: v })} span />
                    <EditField k="City" v={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                    <EditField k="State" v={form.state} onChange={(v) => setForm({ ...form, state: v })} />
                    <EditField k="PIN" v={form.postalCode} onChange={(v) => setForm({ ...form, postalCode: v.replace(/\D/g, "").slice(0, 10) })} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────── */
function Screen({ children }: { children: React.ReactNode }) {
  return <div className="portal flex min-h-screen flex-col items-center justify-center px-5 pt-[116px] text-center" data-portal="admin"><div className="flex flex-col items-center text-[14px] text-[var(--p-muted)]">{children}</div></div>;
}
const TINT: Record<string, string> = { teal: "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]", cyan: "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]", amber: "bg-[var(--p-amber-soft)] text-[var(--p-amber)]", rose: "bg-[var(--p-rose-soft)] text-[var(--p-rose)]" };
function Stat({ icon: I, tint, label, value, sub }: { icon: typeof Calendar; tint: keyof typeof TINT | string; label: string; value: string; sub: string }) {
  return (
    <div className="surface p-4">
      <span className={`grid h-9 w-9 place-items-center rounded-lg ${TINT[tint] ?? TINT.teal}`}><I size={18} /></span>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{label}</p>
      <p className="mt-0.5 truncate font-serif-p text-[18px] font-bold text-[var(--p-ink)]">{value}</p>
      <p className="truncate text-[11.5px] text-[var(--p-muted)]">{sub}</p>
    </div>
  );
}
function QuickAction({ href, icon: I, title, desc }: { href: string; icon: typeof Calendar; title: string; desc: string }) {
  return <Link href={href}><QuickInner icon={I} title={title} desc={desc} /></Link>;
}
function QuickInner({ icon: I, title, desc }: { icon: typeof Calendar; title: string; desc: string }) {
  return (
    <div className="surface surface-hover flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"><I size={18} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-[var(--p-ink)]">{title}</span><span className="block truncate text-[12px] text-[var(--p-muted)]">{desc}</span></span>
      <ArrowRight size={16} className="text-[var(--p-muted)]" />
    </div>
  );
}
function SectionCard({ title, count, empty, emptyText, header, children }: { title: string; count: number; empty: boolean; emptyText: string; header?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
        <h2 className="flex items-center gap-2 font-serif-p text-[15px] font-semibold text-[var(--p-ink)]">{title}<span className="badge">{count}</span></h2>
        {header}
      </div>
      {empty ? <p className="px-5 py-12 text-center text-[13px] text-[var(--p-muted)]">{emptyText}</p> : <div className="divide-y divide-[var(--p-border)]">{children}</div>}
    </div>
  );
}
function Row({ lead, title, sub, right }: { lead: React.ReactNode; title: React.ReactNode; sub: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        {lead}
        <div className="min-w-0"><p className="truncate text-[13.5px] font-semibold text-[var(--p-ink)]">{title}</p><p className="truncate text-[12px] text-[var(--p-muted)]">{sub}</p></div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}
function Chip({ status }: { status: string }) {
  const tone = status === "COMPLETED" || status === "PAID" || status === "REPORTED" ? "bg-[var(--p-teal-soft)] text-[var(--p-teal-deep)]"
    : status === "CANCELLED" ? "bg-[var(--p-rose-soft)] text-[var(--p-rose)]"
    : status === "PARTIALLY_PAID" || status === "PENDING" ? "bg-[var(--p-amber-soft)] text-[var(--p-amber)]"
    : "bg-[var(--p-cyan-soft)] text-[var(--p-cyan-deep)]";
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{STATUS_LABEL[status] ?? cap(status)}</span>;
}
function Grid({ children }: { children: React.ReactNode }) { return <div className="grid grid-cols-2 gap-x-5 gap-y-4">{children}</div>; }
function Field({ k, v, span, icon: I }: { k: string; v: string; span?: boolean; icon?: typeof Phone }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{I && <I size={11} />}{k}</p>
      <p className="mt-0.5 text-[14px] text-[var(--p-ink)]">{v}</p>
    </div>
  );
}
function EditField({ k, v, onChange, span }: { k: string; v: string; onChange: (v: string) => void; span?: boolean }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <label className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">{k}</label>
      <input value={v} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--p-border-strong)] bg-[var(--p-surface)] px-3 py-2 text-[14px] text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]" />
    </div>
  );
}
