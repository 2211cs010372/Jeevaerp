"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Req, Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { PrimaryButton } from "@/components/portal/ui/primitives";
import { api, ApiClientError } from "@/lib/api-client";

/**
 * THE DOCTOR ROSTER, MAINTAINED AT THE FRONT DESK.
 *
 * A consultant's qualification is spelt wrong on every OPD sheet, a visiting
 * surgeon starts on Monday, a department gets renamed - all of it needed an
 * admin, and admin is one person who is not always in the building. The desk
 * that books these doctors forty times a day is the one that notices.
 *
 * IT EDITS PEOPLE, NOT LOGINS. Everything here writes to the Doctor row: the
 * name, the department, the fee, the details that print. Nothing here creates a
 * sign-in account, sets a password or touches a role - those are staff accounts
 * and they stay with admin. See createDoctorProfile for why the line is there.
 */

interface Doctor {
  id: string; name: string; specialization: string; department: string; fee: string;
  /** Council registration number. Null until somebody types it - see the modal. */
  registrationNo: string | null;
  qualification: string | null; experienceYears: number | null; age: number | null;
  languages: string | null; photoUrl: string | null; bio: string | null;
}

const blank = {
  name: "", specialization: "", department: "", consultationFee: "", registrationNo: "",
  qualification: "", experienceYears: "", age: "", languages: "", photoUrl: "", bio: "",
};
type Form = typeof blank;

const money = (v: string | number) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const digits = (v: string) => v.replace(/[^0-9]/g, "");
const decimal = (v: string) => v.replace(/[^0-9.]/g, "");

export default function DoctorsPage() {
  const [rows, setRows] = useState<Doctor[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** null = closed, "new" = adding, a doctor = editing that one. */
  const [editing, setEditing] = useState<Doctor | "new" | null>(null);
  const [f, setF] = useState<Form>({ ...blank });

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ doctors: Doctor[] }>("/reception/doctors");
      setRows(r.doctors); setErr(null);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't load the roster.");
      setRows([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  function open(d: Doctor | "new") {
    setEditing(d);
    setErr(null);
    setF(d === "new" ? { ...blank } : {
      name: d.name, specialization: d.specialization, department: d.department,
      consultationFee: d.fee,
      // Null (never typed) and "" (typed then cleared) both open as an empty
      // box. Whichever it was, the box is the same one, and saving it writes
      // whatever is in it - so adding and editing are the same gesture.
      registrationNo: d.registrationNo ?? "",
      qualification: d.qualification ?? "",
      experienceYears: d.experienceYears?.toString() ?? "",
      age: d.age?.toString() ?? "",
      languages: d.languages ?? "",
      photoUrl: d.photoUrl ?? "",
      bio: d.bio ?? "",
    });
  }

  const set = (k: keyof Form) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const ready = f.name.trim().length >= 2 && f.specialization.trim().length >= 2
    && f.department.trim().length >= 2 && f.consultationFee !== "";

  async function save() {
    if (!ready || editing === null) return;
    setBusy(true); setErr(null);
    // An empty number box means "not recorded", not zero - a doctor whose age
    // nobody typed must not be saved as aged 0.
    const body = {
      name: f.name.trim(), specialization: f.specialization.trim(), department: f.department.trim(),
      consultationFee: Number(f.consultationFee),
      registrationNo: f.registrationNo.trim(),
      qualification: f.qualification.trim(), languages: f.languages.trim(),
      photoUrl: f.photoUrl.trim(), bio: f.bio.trim(),
      ...(f.experienceYears !== "" ? { experienceYears: Number(f.experienceYears) } : {}),
      ...(f.age !== "" ? { age: Number(f.age) } : {}),
    };
    try {
      if (editing === "new") {
        await api.post("/reception/doctors", body);
        setFlash(`${body.name} added to the roster.`);
      } else {
        await api.patch(`/reception/doctors/${editing.id}`, body);
        setFlash(`${body.name} updated.`);
      }
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Couldn't save.");
    } finally { setBusy(false); }
  }

  const s = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((d) =>
    !s || d.name.toLowerCase().includes(s)
    || d.department.toLowerCase().includes(s)
    || d.specialization.toLowerCase().includes(s)
    // An identifier nobody can search by is an identifier nobody can check.
    || (d.registrationNo ?? "").toLowerCase().includes(s));

  const inp = "w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm text-[var(--p-ink)] outline-none focus:border-[var(--p-teal)]";
  const lbl = "mb-1 block text-[12px] font-semibold uppercase tracking-wide text-[var(--p-muted)]";

  return (
    <PortalScroll>
      <div data-rise className="surface dotgrid mb-5 flex flex-wrap items-center justify-between gap-4 px-6 py-5">
        <div>
          <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Doctors</h1>
          <p className="mt-1 text-[13.5px] text-[var(--p-muted)]">
            The roster the booking screen offers. Sign-in accounts stay with admin.
          </p>
        </div>
        <PrimaryButton onClick={() => open("new")}>
          <Icon name="plus" size={15} /> Add doctor
        </PrimaryButton>
      </div>

      {flash && (
        <div data-rise className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[14px] text-[var(--p-cyan-deep)]">
          <span className="flex items-center gap-2"><Icon name="check" size={15} /> {flash}</span>
          <button onClick={() => setFlash(null)}>✕</button>
        </div>
      )}
      {err && editing === null && (
        <div data-rise className="mb-4 rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-4 py-3 text-[14px] text-[var(--p-rose)]">{err}</div>
      )}

      <div data-rise className="surface mb-4 flex items-center gap-2 px-3.5 py-2.5">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Name, department, specialization or reg. no…"
          className="w-full bg-transparent text-sm outline-none" />
        {rows === null && <Spinner size={13} />}
      </div>

      <section data-rise className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-3.5">
          <h3 className="text-[14px] font-semibold text-[var(--p-ink)]">On the roster</h3>
          <span className="badge">{shown.length}</span>
        </div>
        <div className="divide-y divide-[var(--p-border)]">
          {rows === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--p-muted)]">
              <Spinner size={14} /> Loading…
            </div>
          ) : shown.length === 0 ? (
            <p className="px-5 py-10 text-center text-[13px] text-[var(--p-muted)]">
              {s ? "Nobody matches that." : "No doctors on the roster yet."}
            </p>
          ) : shown.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-semibold text-[var(--p-ink)]">{d.name}</span>
                  <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--p-blue-deep)]">{d.department}</span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-[var(--p-muted)]">
                  {d.specialization}
                  {d.qualification ? ` · ${d.qualification}` : ""}
                  {d.experienceYears != null ? ` · ${d.experienceYears} yrs` : ""}
                  {d.languages ? ` · ${d.languages}` : ""}
                </div>
                {/* Set apart from the prose line above: this is an identifier,
                    not a description, and a missing one is worth seeing at a
                    glance rather than reading as a shorter sentence. */}
                <div className="mt-1 text-[11.5px]">
                  {d.registrationNo ? (
                    <span className="font-mono text-[var(--p-text)]">
                      Reg. {d.registrationNo}
                    </span>
                  ) : (
                    <button onClick={() => open(d)}
                      className="font-medium text-[var(--p-amber)] hover:underline">
                      + Add registration no.
                    </button>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[14px] font-semibold text-[var(--p-ink)]">₹{money(d.fee)}</span>
                <button onClick={() => open(d)}
                  className="rounded-lg border border-[var(--p-border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--p-teal)] hover:border-[var(--p-teal)]">
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface w-full max-w-2xl bg-white">
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-6 py-4">
              <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">
                {editing === "new" ? "Add a doctor" : `Edit ${editing.name}`}
              </h3>
              <button onClick={() => setEditing(null)} className="text-[var(--p-muted)] hover:text-[var(--p-ink)]">✕</button>
            </div>

            <div className="max-h-[64vh] space-y-4 overflow-y-auto overscroll-contain p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={lbl}>Name<Req /></label>
                  <input className={inp} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="Dr. A Santhosh" />
                </div>
                <div>
                  <label className={lbl}>Department<Req /></label>
                  <input className={inp} value={f.department} onChange={(e) => set("department")(e.target.value)} placeholder="General Medicine" />
                </div>
                <div>
                  <label className={lbl}>Specialization<Req /></label>
                  <input className={inp} value={f.specialization} onChange={(e) => set("specialization")(e.target.value)} placeholder="Physician" />
                </div>
                <div>
                  <label className={lbl}>Consultation fee<Req /></label>
                  <input className={inp} inputMode="numeric" value={f.consultationFee}
                    onChange={(e) => set("consultationFee")(decimal(e.target.value))} placeholder="400" />
                  {/* Said where it is typed. This is not a directory field - it
                      is what the next patient is charged. */}
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    Every consultation booked with them is billed at this from now on.
                    Visits already booked keep the fee they were booked at.
                  </p>
                </div>
                <div>
                  <label className={lbl}>Qualification</label>
                  <input className={inp} value={f.qualification} onChange={(e) => set("qualification")(e.target.value)} placeholder="MBBS, MD" />
                </div>
                {/* ONE BOX, BOTH JOBS. Empty means it has never been recorded
                    and typing adds it; filled means it is theirs already and
                    typing corrects it in place. There is no separate "add"
                    mode to find, because a second control here would be a
                    second thing to get wrong about the same number. */}
                <div>
                  <label className={lbl}>Registration no.</label>
                  <input className={inp} value={f.registrationNo}
                    onChange={(e) => set("registrationNo")(e.target.value)}
                    placeholder="TSMC/FMR/12345" />
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--p-muted)]">
                    {editing !== "new" && editing?.registrationNo
                      ? "Editing what is on record. Clear the box to remove it."
                      : "State medical council / NMC number, as printed on their stamp."}
                  </p>
                </div>
                <div>
                  <label className={lbl}>Experience (years)</label>
                  <input className={inp} inputMode="numeric" value={f.experienceYears}
                    onChange={(e) => set("experienceYears")(digits(e.target.value))} placeholder="12" />
                </div>
                <div>
                  <label className={lbl}>Age</label>
                  <input className={inp} inputMode="numeric" value={f.age}
                    onChange={(e) => set("age")(digits(e.target.value))} placeholder="41" />
                </div>
                <div className="sm:col-span-2">
                  <label className={lbl}>Languages</label>
                  <input className={inp} value={f.languages} onChange={(e) => set("languages")(e.target.value)} placeholder="Telugu, Hindi, English" />
                </div>
                <div className="sm:col-span-2">
                  <label className={lbl}>Photo URL</label>
                  <input className={inp} value={f.photoUrl} onChange={(e) => set("photoUrl")(e.target.value)} placeholder="https://… or /uploads/…" />
                </div>
                <div className="sm:col-span-2">
                  <label className={lbl}>Bio</label>
                  <textarea rows={3} className={inp} value={f.bio} onChange={(e) => set("bio")(e.target.value)}
                    placeholder="Shown on the public doctor panel." />
                </div>
              </div>

              {editing === "new" && (
                <div className="rounded-lg border border-[var(--p-blue)]/25 bg-[var(--p-blue-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-[var(--p-blue-deep)]">
                  They become bookable straight away, with a round-the-clock diary.
                  This does <b>not</b> create a sign-in account — ask admin if they need to log in.
                </div>
              )}

              {err && (
                <div className="rounded-lg border border-[var(--p-rose)]/25 bg-[var(--p-rose-soft)] px-3.5 py-2.5 text-[12.5px] text-[var(--p-rose)]">{err}</div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--p-border)] px-6 py-4">
              <button onClick={() => setEditing(null)} className="text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)]">Cancel</button>
              <PrimaryButton onClick={save} disabled={!ready || busy}>
                {busy ? <><Spinner size={14} /> Saving…</> : editing === "new" ? "Add doctor" : "Save changes"}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </PortalScroll>
  );
}
