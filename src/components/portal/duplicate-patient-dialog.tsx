"use client";

/**
 * "THIS MOBILE IS ALREADY ON FILE" - one dialog for every counter that can
 * create a patient.
 *
 * Reception's Register and Book, the pharmacy's direct sale and both lab
 * counters all end in registerPatient, which refuses a new Jeeva ID on a number
 * that already has one until somebody has looked (see lib/patient-duplicates).
 * This is where they look. Two ways out, and only two:
 *
 *   · Use this record - the common answer. The bill, the tests, the visit go on
 *     the patient's existing file, and if they are in a bed, onto the stay.
 *   · A different person - a son on his father's phone. Allowed, but only with
 *     a reason typed, which the server keeps in the audit trail. Not offered at
 *     all when the name is the same: that is the same patient, typed in again.
 *
 * PhoneOnFileHint is the early warning - the same lookup, run as the number is
 * typed, so most desks pick the right record before they ever press submit.
 */

import { useEffect, useState } from "react";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { api } from "@/lib/api-client";
import { formatAge } from "@/lib/age";
import { bedShort } from "@/lib/beds";
import { formatPhone, isIndianMobile, notAPatientPhone, toBare10 } from "@/lib/phone";
import { nameKey, type MatchAdmission, type PhoneMatch, type PhoneOnFile } from "@/lib/patient-duplicates";

/** A record on file, from the 409 (with its stay) or from a search (without). */
export type FiledPatient = Omit<PhoneMatch, "admission"> & { admission?: MatchAdmission | null };

const inits = (n: string) => n.split(" ").map((x) => x[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const GENDER: Record<string, string> = { MALE: "M", FEMALE: "F", OTHER: "O" };
const since = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { month: "short", year: "numeric" });

function PatientLine({ p, highlight }: { p: FiledPatient; highlight?: boolean }) {
  const age = formatAge(p);
  return (
    <span className="flex min-w-0 items-start gap-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
        highlight ? "bg-[var(--p-teal)] text-white" : "bg-[var(--p-bg)] text-[var(--p-muted)]"}`}>
        {inits(p.fullName)}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[14px] font-semibold text-[var(--p-ink)]">{p.fullName}</span>
          {highlight && (
            <span className="rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--p-teal-deep)]">
              Same name
            </span>
          )}
        </span>
        <span className="block text-[12px] text-[var(--p-muted)]">
          <span className="tabular">{p.displayId}</span>
          {age && ` · ${age}`}
          {p.gender && ` · ${GENDER[p.gender] ?? p.gender}`}
          {` · since ${since(p.createdAt)}`}
        </span>
        {/* The one fact that changes where the money goes: pick this record
            and the pharmacy bill or the test lands on their stay. */}
        {p.admission && (
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--p-blue-soft)] px-2.5 py-1 text-[10.5px] font-semibold text-[var(--p-blue)]">
            <Icon name="bed" size={11} />
            In a bed · <span className="tabular">{p.admission.ipNumber}</span> · {p.admission.ward} {bedShort(p.admission.bedNo) || p.admission.bedNo}
          </span>
        )}
      </span>
    </span>
  );
}

export function DuplicatePatientDialog({
  onFile, phone, newName, busy = false, onUse, onDifferentPerson, onClose,
}: {
  onFile: PhoneOnFile;
  /** The number as typed - shown in the heading. */
  phone: string;
  /** The name the desk was about to register. */
  newName: string;
  /** A "different person" resubmit is in flight. */
  busy?: boolean;
  onUse: (p: FiledPatient) => void;
  onDifferentPerson: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const key = nameKey(newName);
  const more = onFile.total - onFile.matches.length;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, onClose]);

  return (
    <div className="modal-veil" role="dialog" aria-modal="true" aria-labelledby="dup-title"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="surface flex max-h-[90vh] w-full max-w-lg flex-col bg-white">
        <div className="shrink-0 border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-4">
          <h3 id="dup-title" className="flex items-center gap-2 text-[15px] font-semibold text-[#8a6414]">
            <Icon name="alert" size={16} />
            {onFile.sameName ? "Already registered" : "This mobile is already on file"}
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--p-text)]">
            <span className="font-mono">{formatPhone(phone)}</span> · {onFile.total} record{onFile.total === 1 ? "" : "s"} on this number.
            {" "}A second Jeeva ID splits their history - bills, reports and stays stop adding up.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {onFile.sameName && (
            <p className="rounded-lg bg-[var(--p-rose-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--p-rose)]">
              <b>{newName}</b> is already registered on this number. A new record can&apos;t be made for the same
              person - use the one below.
            </p>
          )}

          <div className="space-y-2">
            {onFile.matches.map((p) => {
              const same = nameKey(p.fullName) === key;
              return (
                <div key={p.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-3 ${
                    same ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)]/40" : "border-[var(--p-border)]"}`}>
                  <PatientLine p={p} highlight={same} />
                  <button type="button" onClick={() => onUse(p)} disabled={busy}
                    className="shrink-0 rounded-lg bg-[var(--p-teal)] px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--p-teal-deep)] disabled:opacity-45">
                    Use this record
                  </button>
                </div>
              );
            })}
            {more > 0 && (
              <p className="text-[12px] text-[var(--p-muted)]">
                …and {more} more on this number. Search by name if the one you want isn&apos;t listed.
              </p>
            )}
          </div>

          {!onFile.sameName && (
            <div className="rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-4">
              <p className="text-[13px] font-semibold text-[var(--p-ink)]">
                Registering someone else who shares this phone?
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                Say who they are to the people above. It is saved with the new record, under your name.
              </p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={200}
                // The dialog can sit inside a counter's <form>; Enter here must
                // mean this button, not resubmit that form without the reason.
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!busy && reason.trim().length >= 3) onDifferentPerson(reason.trim());
                }}
                placeholder="e.g. Son of Ramesh - uses his father's phone"
                className="mt-2.5 w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-teal)]" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)] disabled:opacity-45">
            Cancel
          </button>
          {!onFile.sameName && (
            <button type="button" onClick={() => onDifferentPerson(reason.trim())}
              disabled={busy || reason.trim().length < 3}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--p-amber)]/60 bg-white px-4 py-2 text-[13px] font-semibold text-[#8a6414] transition-colors hover:bg-[var(--p-amber-soft)] disabled:opacity-40">
              {busy ? <><Spinner /> Registering…</> : <>Register {newName.split(" ")[0] || "them"} as a different person</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The records already on a number, looked up as it is typed. Only exact
 * matches on the ten digits - the search itself is a `contains`.
 */
export function usePhoneOnFile(phone: string): FiledPatient[] {
  const [found, setFound] = useState<FiledPatient[]>([]);
  const ten = toBare10(phone);
  const ok = isIndianMobile(ten) && !notAPatientPhone(ten);

  useEffect(() => {
    if (!ok) { setFound([]); return; }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: FiledPatient[] }>(
          `/reception/patients?q=${encodeURIComponent(ten)}`
        );
        if (active) setFound(patients.filter((p) => toBare10(p.phone) === ten));
      } catch { if (active) setFound([]); }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [ten, ok]);

  // Filtered against the number as it is NOW, not as it was when the lookup
  // went out: a number pasted over another would otherwise list the previous
  // number's patients until the next lookup lands, one click from the wrong file.
  return ok ? found.filter((p) => toBare10(p.phone) === ten) : [];
}

/**
 * Under the mobile field of every new-patient form: the hospital's own number
 * refused on the spot, and anyone already on the number offered before submit.
 */
export function PhoneOnFileHint({
  phone, name = "", onUse, useLabel = "Use this record", className = "",
}: {
  phone: string;
  /** The name typed so far - a record with the same one is marked. */
  name?: string;
  onUse: (p: FiledPatient) => void;
  useLabel?: string;
  className?: string;
}) {
  const found = usePhoneOnFile(phone);
  const why = isIndianMobile(phone) ? notAPatientPhone(phone) : null;
  const key = nameKey(name);

  if (why) {
    return (
      <p className={`flex items-start gap-1.5 rounded-lg bg-[var(--p-rose-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--p-rose)] ${className}`}>
        <span className="mt-0.5 shrink-0"><Icon name="alert" size={12} /></span> {why}
      </p>
    );
  }
  if (found.length === 0) return null;

  return (
    <div className={`rounded-lg border border-[var(--p-amber)]/30 bg-[var(--p-amber-soft)] p-3 ${className}`}>
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#8a6414]">
        <Icon name="alert" size={13} />
        This mobile is already on file. Use the existing record so their history stays together.
      </p>
      <div className="mt-2 space-y-1.5">
        {found.slice(0, 4).map((p) => (
          <button key={p.id} type="button" onClick={() => onUse(p)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--p-border)] bg-white p-2.5 text-left transition-colors hover:border-[var(--p-teal)]">
            <PatientLine p={p} highlight={!!key && nameKey(p.fullName) === key} />
            <span className="shrink-0 text-[12px] font-semibold text-[var(--p-teal)]">{useLabel}</span>
          </button>
        ))}
        {found.length > 4 && (
          <p className="text-[11.5px] text-[var(--p-muted)]">…and {found.length - 4} more on this number.</p>
        )}
      </div>
    </div>
  );
}
