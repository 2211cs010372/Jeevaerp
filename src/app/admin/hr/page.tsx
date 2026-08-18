"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { Icon, type IconName } from "@/components/portal/ui/icons";
import { Spinner, Field } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";

interface DoctorProfile {
  id: string;
  specialization: string;
  department: string;
  consultationFee: string;
  qualification: string | null;
  experienceYears: number | null;
  age: number | null;
  languages: string | null;
  photoUrl: string | null;
  bio: string | null;
  active: boolean;
}
interface Staff {
  id: string; username: string; name: string; email: string | null; phone: string;
  role: string; isActive: boolean; lastLoginAt: string | null; doctor: DoctorProfile | null;
}

const ROLES = ["ADMIN", "RECEPTIONIST", "LAB_TECH", "PHARMACIST", "DOCTOR", "INSURANCE_DESK"] as const;
const ROLE_LABEL: Record<string, string> = { ADMIN: "Admin", RECEPTIONIST: "Reception", LAB_TECH: "Lab", PHARMACIST: "Pharmacy", DOCTOR: "Doctor", INSURANCE_DESK: "Insurance" };
const PREFIX: Record<string, string> = { ADMIN: "admin", RECEPTIONIST: "reception", LAB_TECH: "labs", PHARMACIST: "pharmacy", DOCTOR: "doctor", INSURANCE_DESK: "insurance" };
const ROLE_ICON: Record<string, IconName> = { ADMIN: "building", RECEPTIONIST: "calendar", LAB_TECH: "flask", PHARMACIST: "pill", DOCTOR: "activity", INSURANCE_DESK: "shield" };

/**
 * Suggestions, not a closed list - the <datalist> lets an admin type a specialty
 * the hospital adds later without waiting for a code change. Kept here rather
 * than imported from lib/data.ts so the admin bundle doesn't carry the whole
 * public marketing dataset.
 */
const DEPARTMENTS = [
  "General Medicine", "General Surgery", "Gynaecology", "Paediatrics", "Orthopaedics",
  "ENT", "Cardiology", "Neurology", "Neurosurgery", "Urology", "Pulmonology",
  "Psychiatry", "Dermatology", "Plastic Surgery", "Anaesthesiology", "Physiotherapy",
  "Emergency", "Radiology", "Dentistry", "Ophthalmology",
];

const EMPTY_STAFF = { role: "RECEPTIONIST", handle: "", name: "", email: "", phone: "", password: "" };
const EMPTY_DOCTOR = {
  specialization: "", department: "", consultationFee: "", qualification: "",
  experienceYears: "", age: "", languages: "", photoUrl: "", bio: "",
};
type DoctorForm = typeof EMPTY_DOCTOR;

const fmtLogin = (iso: string | null) => {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + ", " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

export default function HrPage() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | (typeof ROLES)[number]>("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  /** null = closed. Otherwise a create or an edit of one account. */
  const [editor, setEditor] = useState<{ mode: "create" } | { mode: "edit"; target: Staff } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Staff | null>(null);

  const [f, setF] = useState(EMPTY_STAFF);
  const [d, setD] = useState<DoctorForm>(EMPTY_DOCTOR);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const isEdit = editor?.mode === "edit";
  // On edit, the doctor half shows when the account already has a profile;
  // on create, when DOCTOR is the selected role.
  const showDoctorFields = isEdit ? Boolean(editor.target.doctor) : f.role === "DOCTOR";
  const username = f.handle ? `${PREFIX[f.role]}.${f.handle.trim().toLowerCase()}` : "";

  async function load() {
    setLoading(true);
    try { const { staff } = await api.get<{ staff: Staff[] }>("/admin/staff"); setStaff(staff); setError(null); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Couldn't load staff."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setError(null); setNotice(null);
    setF(EMPTY_STAFF); setD(EMPTY_DOCTOR);
    setEditor({ mode: "create" });
  }

  function openEdit(u: Staff) {
    setError(null); setNotice(null);
    setF({
      role: u.role,
      handle: u.username.includes(".") ? u.username.split(".").slice(1).join(".") : u.username,
      name: u.name,
      email: u.email ?? "",
      // Stored as +91…; the input takes the 10 national digits.
      phone: u.phone.replace(/^\+91/, ""),
      password: "",
    });
    setD(u.doctor ? {
      specialization: u.doctor.specialization,
      department: u.doctor.department,
      consultationFee: u.doctor.consultationFee,
      qualification: u.doctor.qualification ?? "",
      experienceYears: u.doctor.experienceYears?.toString() ?? "",
      age: u.doctor.age?.toString() ?? "",
      languages: u.doctor.languages ?? "",
      photoUrl: u.doctor.photoUrl ?? "",
      bio: u.doctor.bio ?? "",
    } : EMPTY_DOCTOR);
    setEditor({ mode: "edit", target: u });
  }

  /** Only send the optional numbers that were actually filled in. */
  function doctorPayload() {
    return {
      specialization: d.specialization.trim(),
      department: d.department.trim(),
      consultationFee: Number(d.consultationFee || 0),
      qualification: d.qualification.trim(),
      experienceYears: d.experienceYears === "" ? undefined : Number(d.experienceYears),
      age: d.age === "" ? undefined : Number(d.age),
      languages: d.languages.trim(),
      photoUrl: d.photoUrl.trim(),
      bio: d.bio.trim(),
    };
  }

  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      if (editor?.mode === "edit") {
        await api.patch(`/admin/staff/${editor.target.id}`, {
          name: f.name, email: f.email || "", phone: f.phone,
          ...(f.password ? { password: f.password } : {}),
          ...(editor.target.doctor ? { doctor: doctorPayload() } : {}),
        });
        setNotice(`${f.name} updated.`);
      } else {
        await api.post("/admin/staff", {
          username, name: f.name, email: f.email || undefined, phone: f.phone,
          role: f.role, password: f.password,
          ...(f.role === "DOCTOR" ? { doctor: doctorPayload() } : {}),
        });
        setNotice(f.role === "DOCTOR"
          ? `${f.name} added, with a 24×7 consulting diary and bookable slots for the next 30 days.`
          : `${f.name} added. They sign in as ${username}.`);
      }
      setEditor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not save the account.");
    } finally { setBusy(false); }
  }

  async function toggle(u: Staff) {
    setError(null); setNotice(null);
    try { await api.post("/admin/staff/active", { userId: u.id, isActive: !u.isActive }); await load(); }
    catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not update."); }
  }

  async function doDelete(u: Staff) {
    setBusy(true); setError(null); setNotice(null);
    try {
      // The server may have DISABLED rather than deleted, when records point at
      // this account. Show what it actually did, never a blanket "deleted".
      const res = await api.del<{ outcome: "deleted" | "deactivated"; message: string }>(`/admin/staff/${u.id}`);
      setNotice(res.message);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not remove the account.");
    } finally { setBusy(false); }
  }

  async function uploadPhoto(file: File) {
    setUploading(true); setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/v1/admin/doctor-photo", { method: "POST", body, credentials: "same-origin" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setD((prev) => ({ ...prev, photoUrl: json.url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}; for (const r of ROLES) c[r] = 0;
    for (const s of staff) if (s.isActive) c[s.role] = (c[s.role] ?? 0) + 1;
    return c;
  }, [staff]);
  const activeCount = staff.filter((s) => s.isActive).length;

  const shown = useMemo(() => staff.filter((s) => {
    if (filter !== "ALL" && s.role !== filter) return false;
    if (q.trim()) {
      const t = q.toLowerCase();
      return s.name.toLowerCase().includes(t) || s.username.toLowerCase().includes(t) || s.phone.includes(t)
        || (s.doctor?.specialization.toLowerCase().includes(t) ?? false)
        || (s.doctor?.department.toLowerCase().includes(t) ?? false);
    }
    return true;
  }), [staff, filter, q]);

  const fld = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const doctorReady = Boolean(d.specialization.trim() && d.department.trim() && d.consultationFee !== "");
  const canSave = isEdit
    ? Boolean(f.name.length >= 2 && f.phone.length === 10 && (!f.password || f.password.length >= 8) && (!showDoctorFields || doctorReady))
    : Boolean(f.handle && f.name.length >= 2 && f.phone.length === 10 && f.password.length >= 8 && (!showDoctorFields || doctorReady));

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--p-teal)]">Admin console</p>
          <h1 className="mt-1 font-serif-p text-[24px] font-semibold text-[var(--p-ink)]">HR &amp; staff</h1>
          <p className="mt-1 text-[13px] text-[var(--p-muted)]">Headcount, accounts and access. Usernames are <span className="font-mono">role.name</span>; staff sign in with username + OTP or password. Adding a doctor also creates their consulting diary.</p>
        </div>
        <PrimaryButton onClick={openCreate}><Icon name="plus" size={15} /> Add staff or doctor</PrimaryButton>
      </div>

      {error && <div className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[13px] text-[var(--p-rose)]">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-[var(--p-teal)]/25 bg-[var(--p-teal-soft)] px-4 py-3 text-[13px] text-[var(--p-teal-deep)]">{notice}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
      ) : (
        <>
          {/* Headcount */}
          <div data-rise className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <div className="surface px-5 py-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]">Active staff</div>
              <div className="mt-1 font-mono text-[21px] font-bold text-[var(--p-teal)]">{activeCount}</div>
              <div className="mt-0.5 text-[12px] text-[var(--p-muted)]">{staff.length} total accounts</div>
            </div>
            {ROLES.map((r) => (
              <div key={r} className="surface px-5 py-4">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--p-muted)]"><Icon name={ROLE_ICON[r]} size={13} /> {ROLE_LABEL[r]}</div>
                <div className="mt-1 font-mono text-[21px] font-bold text-[var(--p-ink)]">{counts[r]}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div data-rise className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(["ALL", ...ROLES] as const).map((r) => (
                <button key={r} onClick={() => setFilter(r)}
                  className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${filter === r ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>
                  {r === "ALL" ? "All" : ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3 py-1.5">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, username, phone, specialty" className="w-64 bg-transparent text-[13px] text-[var(--p-ink)] outline-none" />
            </div>
          </div>

          {/* Directory */}
          <section data-rise className="surface overflow-hidden">
            <div className="divide-y divide-[var(--p-border)]">
              {shown.length === 0 ? (
                <p className="px-6 py-10 text-center text-[13px] text-[var(--p-muted)]">
                  {staff.length === 0 ? "No staff yet. Use “Add staff or doctor” to create the first account." : "No staff match."}
                </p>
              ) : shown.map((u) => (
                <div key={u.id} className={`flex flex-wrap items-center gap-3 px-6 py-3.5 ${u.isActive ? "" : "opacity-60"}`}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {u.doctor?.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.doctor.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--p-teal-soft)] text-[12px] font-bold text-[var(--p-teal-deep)]">
                        {u.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-[var(--p-ink)]">{u.name}</span>
                        <span className="rounded bg-[var(--p-border)]/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--p-muted)]">{ROLE_LABEL[u.role] ?? u.role}</span>
                      </div>
                      <div className="truncate font-mono text-[12px] text-[var(--p-muted)]">{u.username} · {u.phone}{u.email ? ` · ${u.email}` : ""}</div>
                      {u.doctor && (
                        <div className="truncate text-[12px] text-[var(--p-muted)]">
                          {u.doctor.specialization} · {u.doctor.department} · ₹{Number(u.doctor.consultationFee).toFixed(0)}
                          {u.doctor.experienceYears != null && ` · ${u.doctor.experienceYears} yrs`}
                          {u.doctor.qualification && ` · ${u.doctor.qualification}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-[var(--p-muted)]">
                    <div>Last sign-in</div>
                    <div className="text-[var(--p-ink)]">{fmtLogin(u.lastLoginAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEdit(u)} title="Edit details"
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                      Edit
                    </button>
                    <button onClick={() => toggle(u)}
                      className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${u.isActive ? "border-[var(--p-teal)]/40 text-[var(--p-teal-deep)]" : "border-[var(--p-rose)]/40 text-[var(--p-rose)]"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </button>
                    <button onClick={() => { setError(null); setNotice(null); setConfirmDelete(u); }} title="Remove this account"
                      className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--p-rose)] hover:border-[var(--p-rose)] hover:bg-[var(--p-rose-soft)]">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ---- Create / edit ---- */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={() => !busy && setEditor(null)}>
          <div className={`my-8 w-full rounded-2xl bg-white p-6 shadow-xl ${showDoctorFields ? "max-w-2xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif-p text-[18px] font-semibold text-[var(--p-ink)]">
              {isEdit ? `Edit ${editor.target.name}` : "Add staff or doctor"}
            </h2>
            <p className="mt-1 text-[12px] text-[var(--p-muted)]">
              {isEdit
                ? <>Signs in as <span className="font-mono">{editor.target.username}</span>. Role and username can&apos;t be changed.</>
                : <>Username becomes <span className="font-mono">{username || `${PREFIX[f.role]}.name`}</span>.</>}
            </p>

            <div className="mt-4 space-y-3">
              {!isEdit && (
                <Field label="Role">
                  <div className="flex flex-wrap gap-1.5">
                    {ROLES.map((r) => (
                      <button key={r} onClick={() => setF({ ...f, role: r })}
                        className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${f.role === r ? "border-[var(--p-teal)] bg-[var(--p-teal)] text-white" : "border-[var(--p-border)] text-[var(--p-muted)]"}`}>{ROLE_LABEL[r]}</button>
                    ))}
                  </div>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                {!isEdit && (
                  <Field label="Handle" required>
                    <input className={fld} value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} placeholder={f.role === "DOCTOR" ? "shireesha" : "ravi"} />
                  </Field>
                )}
                <Field label="Full name" span={isEdit} required>
                  <input className={fld} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.role === "DOCTOR" ? "Dr. Shireesha M" : "Ravi Kumar"} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile" required><input className={fld} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} inputMode="numeric" placeholder="10 digits" /></Field>
                <Field label="Email (optional)"><input className={fld} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@hospital.in" /></Field>
              </div>
              <Field label={isEdit ? "New password (leave blank to keep the current one)" : "Temporary password"} required={!isEdit}>
                <input className={fld} type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={isEdit ? "unchanged" : "min 8 characters"} />
              </Field>

              {showDoctorFields && (
                <div className="space-y-3 rounded-xl border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--p-muted)]">Consulting profile</p>
                    <p className="text-[12px] text-[var(--p-muted)]">Shown on the public directory and the booking cards.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Specialization" required>
                      <input className={fld} value={d.specialization} onChange={(e) => setD({ ...d, specialization: e.target.value })} placeholder="Obstetrician & Gynaecologist" />
                    </Field>
                    <Field label="Department" required>
                      <input className={fld} list="dept-options" value={d.department} onChange={(e) => setD({ ...d, department: e.target.value })} placeholder="Gynaecology" />
                      <datalist id="dept-options">{DEPARTMENTS.map((x) => <option key={x} value={x} />)}</datalist>
                    </Field>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Fee (₹)" required>
                      <input className={fld} inputMode="numeric" value={d.consultationFee} onChange={(e) => setD({ ...d, consultationFee: e.target.value.replace(/[^\d.]/g, "") })} placeholder="400" />
                    </Field>
                    <Field label="Experience (yrs)">
                      <input className={fld} inputMode="numeric" value={d.experienceYears} onChange={(e) => setD({ ...d, experienceYears: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="12" />
                    </Field>
                    <Field label="Age">
                      <input className={fld} inputMode="numeric" value={d.age} onChange={(e) => setD({ ...d, age: e.target.value.replace(/\D/g, "").slice(0, 3) })} placeholder="40" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Qualification">
                      <input className={fld} value={d.qualification} onChange={(e) => setD({ ...d, qualification: e.target.value })} placeholder="MBBS, MS" />
                    </Field>
                    <Field label="Languages">
                      <input className={fld} value={d.languages} onChange={(e) => setD({ ...d, languages: e.target.value })} placeholder="Telugu, English" />
                    </Field>
                  </div>

                  <Field label="Photo">
                    <div className="flex flex-wrap items-center gap-3">
                      {d.photoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.photoUrl} alt="" className="h-14 w-14 rounded-full border border-[var(--p-border)] object-cover" />
                      )}
                      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="hidden"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); }} />
                      <button type="button" onClick={() => photoInput.current?.click()} disabled={uploading}
                        className="rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--p-text)] hover:border-[var(--p-teal)] hover:text-[var(--p-teal)] disabled:opacity-50">
                        {uploading ? <span className="flex items-center gap-1.5"><Spinner size={12} /> Uploading…</span> : d.photoUrl ? "Replace photo" : "Upload photo"}
                      </button>
                      {d.photoUrl && (
                        <button type="button" onClick={() => setD({ ...d, photoUrl: "" })} className="text-[12px] font-semibold text-[var(--p-rose)] hover:underline">Remove</button>
                      )}
                    </div>
                    <input className={`${fld} mt-2 font-mono text-[12px]`} value={d.photoUrl} onChange={(e) => setD({ ...d, photoUrl: e.target.value })} placeholder="…or paste a URL / /images/doctor-1.avif" />
                  </Field>

                  <Field label="About (shown on their profile page)">
                    <textarea rows={3} className={fld} value={d.bio} onChange={(e) => setD({ ...d, bio: e.target.value })} placeholder="Experienced consultant in women's health providing antenatal care…" />
                  </Field>
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setEditor(null)} disabled={busy} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] disabled:opacity-40">Cancel</button>
              <PrimaryButton onClick={save} disabled={busy || !canSave}>
                {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={15} /> {isEdit ? "Save changes" : "Create account"}</>}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete confirmation ---- */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif-p text-[18px] font-semibold text-[var(--p-ink)]">Remove {confirmDelete.name}?</h2>
            <div className="mt-3 space-y-3 text-[13px] text-[var(--p-text)]">
              <p><span className="font-mono">{confirmDelete.username}</span> will no longer be able to sign in.</p>
              <p className="text-[var(--p-muted)]">
                If they have booked appointments, signed invoices, run lab tests or seen patients, the account is
                <span className="font-medium text-[var(--p-ink)]"> disabled instead of deleted</span> — those records
                have to stay signed by a real person. Otherwise it is removed completely.
              </p>
              {confirmDelete.doctor && (
                <p className="rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[12px] text-[var(--p-rose)]">
                  This is a doctor. Their consulting diary and any unbooked slots go with the account, and they drop off the public directory.
                </p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={busy} className="rounded-lg border border-[var(--p-border)] px-4 py-2 text-sm font-medium text-[var(--p-text)] disabled:opacity-40">Cancel</button>
              <button onClick={() => doDelete(confirmDelete)} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? <><Spinner size={14} /> Removing…</> : "Remove account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
