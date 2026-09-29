"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/portal/ui/icons";
import { Spinner } from "@/components/portal/ui/form-atoms";
import { PortalScroll } from "@/components/portal/portal-scroll";
import { api, ApiClientError } from "@/lib/api-client";
import { formatAge } from "@/lib/age";
import { formatPhone } from "@/lib/phone";
import { nameKey } from "@/lib/patient-duplicates";

interface PatientRow {
  id: string; displayId: string; fullName: string; age: number | null;
  /** Set where the desk gave a real date, or an age in months or days. See lib/age. */
  dob: string | null;
  bloodGroup: string | null; phone: string; city: string | null; createdAt: string;
}
const inits = (n: string) => n.split(" ").map((x) => x[0]).slice(0, 2).join("");

export default function PatientsPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PatientRow[]>([]);
  // ── DUPLICATES ──
  // Same person, two UHIDs. Their history is split, so a doctor checking
  // allergies sees half of it. Not an admin annoyance - a clinical hazard.
  interface DupPatient {
    id: string; displayId: string; fullName: string; age: number | null;
    gender: string | null; createdAt: string; visits: number; bills: number;
    admitted: boolean; ipNumber: string | null;
  }
  /** `placeholder`: the hospital's own number - different people, never merged. */
  interface DupGroup { phone: string; placeholder: boolean; patients: DupPatient[] }
  type Moved = { visits: number; bills: number; tests: number; prescriptions: number; admissions: number };

  const [dups, setDups] = useState<DupGroup[]>([]);
  /** One kept record, and the ones folded into it - any number, ticked by hand. */
  const [merging, setMerging] = useState<{ group: DupGroup; keepId: string; mergeIds: string[] } | null>(null);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeFlash, setMergeFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDups = async () => {
    try {
      const { groups } = await api.get<{ groups: DupGroup[] }>("/reception/duplicates");
      setDups(groups);
    } catch { setDups([]); }
  };
  useEffect(() => { loadDups(); }, []);

  const realDups = dups.filter((g) => !g.placeholder);
  const placeholderDups = dups.filter((g) => g.placeholder);

  /**
   * What starts ticked. Two records on a number: the other one - that was the
   * whole of the old pair merge. Three or more: only the ones with the SAME
   * name as the keeper, because a family phone is several real people and a
   * wrong tick here cannot be undone. A record in a bed is never folded away.
   */
  function defaultMergeIds(g: DupGroup, keepId: string): string[] {
    const keep = g.patients.find((p) => p.id === keepId);
    const others = g.patients.filter((p) => p.id !== keepId && !p.admitted);
    if (g.patients.length === 2) return others.map((p) => p.id);
    return others.filter((p) => keep && nameKey(p.fullName) === nameKey(keep.fullName)).map((p) => p.id);
  }

  function openMerge(g: DupGroup) {
    // The one in a bed has to be the keeper - its admission cannot move.
    const keepId = (g.patients.find((p) => p.admitted) ?? g.patients[0]).id;
    setMerging({ group: g, keepId, mergeIds: defaultMergeIds(g, keepId) });
    setMergeReason("");
  }

  /**
   * Fold each ticked record into the keeper, one call at a time. The server
   * merges pairs - that is the unit it can check and audit - so a group of
   * five is four merges. If one fails the rest are not attempted, and the flash
   * says exactly how far it got.
   */
  async function doMerge() {
    if (!merging || merging.mergeIds.length === 0) return;
    setMergeBusy(true);
    const total: Moved = { visits: 0, bills: 0, tests: 0, prescriptions: 0, admissions: 0 };
    const done: string[] = [];
    let kept = "";
    try {
      for (const mergeId of merging.mergeIds) {
        const r = await api.post<{ kept: string; merged: string; moved: Moved }>(
          "/reception/duplicates",
          { keepId: merging.keepId, mergeId, reason: mergeReason.trim() }
        );
        kept = r.kept; done.push(r.merged);
        for (const k of Object.keys(total) as (keyof Moved)[]) total[k] += r.moved[k];
      }
      setMergeFlash(
        `${done.join(", ")} folded into ${kept}. Moved ${total.visits} visit(s), ${total.bills} bill(s), ` +
        `${total.tests} test(s), ${total.prescriptions} prescription(s), ${total.admissions} admission(s).`
      );
      setMerging(null); setMergeReason("");
    } catch (e) {
      const why = e instanceof ApiClientError ? e.message : "Could not merge.";
      setMergeFlash(done.length ? `Merged ${done.join(", ")} - then stopped: ${why}` : why);
      setMerging(null);
    } finally {
      setMergeBusy(false);
      await loadDups();
    }
  }

  useEffect(() => {
    let active = true; setLoading(true);
    const t = setTimeout(async () => {
      try {
        const { patients } = await api.get<{ patients: PatientRow[] }>(`/reception/patients?q=${encodeURIComponent(q)}&limit=30`);
        if (active) setRows(patients);
      } catch { if (active) setRows([]); } finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q]);

  return (
    <PortalScroll>
      {mergeFlash && (
        <div data-rise className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[var(--p-cyan)]/30 bg-[var(--p-cyan-soft)] px-4 py-3 text-[13px] text-[var(--p-cyan-deep)]">
          <span>{mergeFlash}</span>
          <button onClick={() => setMergeFlash(null)}>✕</button>
        </div>
      )}

      {/* ─────────── POSSIBLE DUPLICATES ───────────
          Same phone, two UHIDs. Almost always one person registered twice -
          once at a walk-in, once in an emergency by a different clerk. Their
          history is split, so a doctor checking allergies sees half of it. */}
      {realDups.length > 0 && (
        <section data-rise className="surface mb-5 overflow-hidden border-[var(--p-amber)]/35">
          <div className="border-b border-[var(--p-border)] bg-[var(--p-amber-soft)] px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[#8a6414]">
              <Icon name="alert" size={15} />
              {realDups.length} possible duplicate{realDups.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--p-text)]">
              Same phone number, different Jeeva IDs. If it&apos;s one person, their history is
              currently <b>split across records</b> - a doctor checking allergies would see
              only part of it, and a stay&apos;s bill misses what was charged to the other card.
            </p>
          </div>

          <div className="divide-y divide-[var(--p-border)]">
            {realDups.map((g) => {
              const inBed = g.patients.filter((p) => p.admitted);
              return (
                <div key={g.phone} className="px-5 py-4">
                  <p className="mb-2.5 font-mono text-[12px] font-semibold text-[var(--p-muted)]">{formatPhone(g.phone)}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.patients.map((p, i) => (
                      <div key={p.id} className="rounded-lg border border-[var(--p-border)] px-3.5 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-[var(--p-ink)]">{p.fullName}</span>
                          {i === 0 && (
                            <span className="rounded bg-[var(--p-teal-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--p-teal-deep)]">
                              Older
                            </span>
                          )}
                          {p.admitted && (
                            <span className="rounded bg-[var(--p-blue-soft)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--p-blue)]">
                              In a bed{p.ipNumber ? ` · ${p.ipNumber}` : ""}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-[12px] text-[var(--p-muted)]">{p.displayId}</div>
                        <div className="mt-1 text-[12px] text-[var(--p-muted)]">
                          {p.visits} visit{p.visits === 1 ? "" : "s"} · {p.bills} bill{p.bills === 1 ? "" : "s"} ·
                          since {new Date(p.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {inBed.length > 1 ? (
                    <p className="mt-3 rounded-lg bg-[var(--p-bg)] px-3 py-2 text-[12px] text-[var(--p-muted)]">
                      <b>Two of these are in a bed.</b> A record with a live admission can only be the one kept -
                      merge once one of them is discharged.
                    </p>
                  ) : (
                    <button onClick={() => openMerge(g)}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--p-amber)]/50 px-3.5 py-2 text-[13px] font-semibold text-[#8a6414] transition-colors hover:bg-[var(--p-amber-soft)]">
                      <Icon name="users" size={14} />
                      {g.patients.length === 2 ? "These are the same person - merge" : `Merge records on this number (${g.patients.length})`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─────────── NOT A PATIENT'S NUMBER ───────────
          The hospital's own mobile, typed in for walk-ins who had none. The
          records on it are DIFFERENT people - 154 names on one number - so they
          are never offered for merge. The fix is one record at a time: put a
          real number on each file when that patient next comes in. */}
      {placeholderDups.length > 0 && (
        <section data-rise className="surface mb-5 overflow-hidden">
          <div className="border-b border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--p-ink)]">
              <Icon name="smartphone" size={15} />
              Registered on the hospital&apos;s number - not duplicates
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--p-muted)]">
              These patients had no phone, so a desk typed the hospital&apos;s own. They are different people -
              <b> don&apos;t merge them</b>. When one of them comes in, open their file and put their own (or an
              attendant&apos;s) number on it. New registrations on these numbers are now refused.
            </p>
          </div>
          <div className="divide-y divide-[var(--p-border)]">
            {placeholderDups.map((g) => (
              <div key={g.phone} className="px-5 py-3.5">
                <p className="mb-2 text-[12px] text-[var(--p-muted)]">
                  <span className="font-mono font-semibold">{formatPhone(g.phone)}</span> · {g.patients.length} patients
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {/* Newest first - the ones most likely to be back soon. */}
                  {[...g.patients].reverse().slice(0, 12).map((p) => (
                    <Link key={p.id} href={`/patients/${p.displayId}`}
                      className="rounded-full border border-[var(--p-border)] px-2.5 py-1 text-[11.5px] text-[var(--p-text)] transition-colors hover:border-[var(--p-teal)] hover:text-[var(--p-teal)]">
                      {p.fullName} <span className="font-mono text-[10.5px] text-[var(--p-muted)]">{p.displayId}</span>
                    </Link>
                  ))}
                  {g.patients.length > 12 && (
                    <span className="px-1 py-1 text-[11.5px] text-[var(--p-muted)]">
                      +{g.patients.length - 12} more - search the number below
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────── MERGE ─────────── */}
      {merging && (() => {
        const bedded = merging.group.patients.find((p) => p.admitted);
        const keeper = merging.group.patients.find((p) => p.id === merging.keepId);
        const n = merging.mergeIds.length;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!mergeBusy) setMerging(null); }}>
            <div onClick={(e) => e.stopPropagation()} className="surface flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden">
              <div className="shrink-0 border-b border-[var(--p-border)] px-5 py-4">
                <h3 className="text-[15px] font-semibold text-[var(--p-ink)]">
                  Merge records on {formatPhone(merging.group.phone)}
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--p-muted)]">
                  Pick the one to <b>keep</b>, then tick every record that is the <b>same person</b>.
                  Anyone else on this number is left alone.
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
                {bedded && (
                  <p className="rounded-lg bg-[var(--p-blue-soft)] px-4 py-3 text-[12px] leading-relaxed text-[var(--p-blue)]">
                    <b>{bedded.displayId}</b> is in a bed{bedded.ipNumber ? ` (${bedded.ipNumber})` : ""}, so it is the record kept.
                    Its admission stays exactly where it is; the other card&apos;s visits and bills move onto it.
                  </p>
                )}

                <div className="space-y-2">
                  {merging.group.patients.map((p, i) => {
                    const keep = merging.keepId === p.id;
                    const ticked = merging.mergeIds.includes(p.id);
                    // A bed pins the keeper: nothing else may be picked while one is admitted.
                    const canKeep = !bedded || p.admitted;
                    return (
                      <div key={p.id}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-all ${
                          keep
                            ? "border-[var(--p-teal)] bg-[var(--p-teal-soft)] shadow-[0_0_0_3px_var(--p-teal-glow,rgba(0,150,136,.15))]"
                            : ticked ? "border-[var(--p-rose)]/50 bg-[var(--p-rose-soft)]/40" : "border-[var(--p-border)]"}`}>
                        <button type="button" disabled={!canKeep || mergeBusy}
                          onClick={() => setMerging({ ...merging, keepId: p.id, mergeIds: defaultMergeIds(merging.group, p.id) })}
                          className="min-w-0 flex-1 text-left disabled:cursor-default">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-[14px] font-semibold text-[var(--p-ink)]">{p.fullName}</span>
                            {i === 0 && <span className="text-[10px] font-bold uppercase text-[var(--p-muted)]">older</span>}
                            {p.admitted && <span className="text-[10px] font-bold uppercase text-[var(--p-blue)]">in a bed</span>}
                          </span>
                          <span className="block font-mono text-[12px] text-[var(--p-muted)]">{p.displayId}</span>
                          <span className="block text-[12px] text-[var(--p-muted)]">
                            {p.visits} visits · {p.bills} bills{canKeep && !keep ? " · tap to keep this one" : ""}
                          </span>
                        </button>
                        {keep ? (
                          <span className="shrink-0 rounded-full bg-[var(--p-teal)] px-2.5 py-1 text-[11px] font-bold uppercase text-white">Keep this</span>
                        ) : p.admitted ? (
                          <span className="shrink-0 text-[11px] text-[var(--p-muted)]">In a bed - can&apos;t merge away</span>
                        ) : (
                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] font-semibold text-[var(--p-rose)]">
                            <input type="checkbox" checked={ticked} disabled={mergeBusy}
                              onChange={(e) => setMerging({
                                ...merging,
                                mergeIds: e.target.checked
                                  ? [...merging.mergeIds, p.id]
                                  : merging.mergeIds.filter((id) => id !== p.id),
                              })}
                              className="h-4 w-4 accent-[var(--p-rose)]" />
                            Same person
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-lg bg-[var(--p-rose-soft)] px-4 py-3">
                  <p className="text-[12px] leading-relaxed text-[var(--p-rose)]">
                    <b>This cannot be undone.</b> Every visit, bill, lab test, prescription and admission on a
                    ticked record moves onto the one you keep. Their Jeeva IDs stop working - anyone who quotes
                    one will be told it doesn&apos;t exist.
                  </p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--p-text)]">
                    Nothing is deleted. The old records stay in the audit trail forever, with your name on them.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-[var(--p-text)]">
                    Why are you sure these are the same person?
                  </label>
                  <input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} disabled={mergeBusy}
                    placeholder="Same phone, same DOB, confirmed with the patient"
                    className="w-full rounded-lg border border-[var(--p-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--p-teal)]" />
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--p-border)] bg-[var(--p-bg)] px-5 py-3">
                <button onClick={() => setMerging(null)} disabled={mergeBusy} className="rounded-lg px-4 py-2 text-[13px] font-medium text-[var(--p-muted)] hover:text-[var(--p-ink)] disabled:opacity-40">
                  Cancel
                </button>
                <button onClick={doMerge} disabled={mergeBusy || n === 0 || mergeReason.trim().length < 3}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--p-rose)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
                  {mergeBusy
                    ? <><Spinner /> Merging…</>
                    : n === 0 ? <>Tick the same person</> : <>Merge {n} into {keeper?.displayId} - permanently</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div data-rise className="surface dotgrid mb-6 px-6 py-5">
        <h1 className="font-serif-p text-[22px] font-semibold text-[var(--p-ink)]">Patients</h1>
        <p className="mt-1 text-[14px] text-[var(--p-muted)]">Search the register. Click a patient to view, edit, or bill them.</p>
        <div className="mt-4 flex max-w-md items-center gap-2 rounded-lg border border-[var(--p-border)] bg-white px-3.5 py-2.5">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Jeeva ID or phone…" className="w-full text-sm outline-none" autoFocus />
          {loading && <Spinner size={14} />}
        </div>
      </div>

      <section data-rise className="surface overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[14px] text-[var(--p-muted)]"><Spinner /> Loading…</div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-[var(--p-muted)]">No patients found.</p>
        ) : (
          <div className="divide-y divide-[var(--p-border)]">
            {rows.map((p) => (
              <Link key={p.id} href={`/patients/${p.displayId}`} className="flex items-center justify-between gap-3 px-6 py-3.5 transition-colors hover:bg-[var(--p-bg)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--p-teal-soft)] font-serif-p text-[13px] font-semibold text-[var(--p-teal)]">{inits(p.fullName)}</div>
                  <div>
                    <div className="text-[14px] font-medium text-[var(--p-ink)]">{p.fullName}</div>
                    <div className="text-[13px] text-[var(--p-muted)]">
                      <span className="tabular">{p.displayId}</span> · {p.phone}
                      {formatAge(p) && ` · ${formatAge(p)}`}{p.bloodGroup && ` · ${p.bloodGroup}`}{p.city && ` · ${p.city}`}
                    </div>
                  </div>
                </div>
                <Icon name="chevron" size={16} />
              </Link>
            ))}
          </div>
        )}
      </section>
    </PortalScroll>
  );
}
