"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { DEPARTMENTS, HOSPITAL, type Doctor } from "@/lib/data";
import { daysInWords } from "@/lib/opd";

/**
 * The long-form half of the profile: everything a family reads AFTER they've
 * seen the times, while deciding whether this is the right person.
 *
 * Tabs rather than a long scroll because the three questions are genuinely
 * separate - "who are they", "do they treat my problem", "what happens when I
 * turn up" - and a patient usually only has one of them. FAQs sit alongside
 * rather than below, because the questions they answer are the ones that stop
 * someone booking, and burying them under three tabs hides them.
 */

const TABS = ["About", "Expertise", "At the clinic"] as const;
type Tab = (typeof TABS)[number];

export function DoctorTabs({ doctor }: { doctor: Doctor }) {
  const [tab, setTab] = useState<Tab>("About");
  const dept = DEPARTMENTS.find((d) => d.name === doctor.department);
  const baseId = useId();

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      {/* ── tabbed description ─────────────────────────────────────────────── */}
      <section className="min-w-0 rounded-[1.75rem] bg-white p-1.5 ring-1 ring-black/5">
        <div className="min-w-0 rounded-[1.35rem] p-5 sm:p-7">
          <div role="tablist" aria-label={`About ${doctor.name}`} className="flex flex-wrap gap-1.5 border-b border-[var(--line)] pb-4">
            {TABS.map((t) => {
              const on = tab === t;
              return (
                <button
                  key={t}
                  role="tab"
                  id={`${baseId}-tab-${t}`}
                  aria-selected={on}
                  aria-controls={`${baseId}-panel-${t}`}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                    on
                      ? "bg-[var(--teal)] text-white"
                      : "text-[var(--ink-soft)] hover:bg-[var(--bone)] hover:text-[var(--ink)]"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${baseId}-panel-${tab}`}
            aria-labelledby={`${baseId}-tab-${tab}`}
            className="pt-5"
          >
            {tab === "About" && (
              <div className="space-y-5">
                <p className="text-[15px] leading-[1.75] text-[var(--ink-soft)]">{doctor.bio}</p>
                <dl className="grid gap-x-8 gap-y-4 border-t border-[var(--line)] pt-5 sm:grid-cols-3">
                  <Fact k="Speaks" v={doctor.languages} />
                  <Fact k="In practice" v={`${doctor.experience} years`} />
                  <Fact k="Qualification" v={doctor.qualification} />
                </dl>
              </div>
            )}

            {tab === "Expertise" && (
              <div className="space-y-5">
                {dept && <p className="text-[15px] leading-[1.75] text-[var(--ink-soft)]">{dept.blurb}</p>}
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                    What this clinic treats
                  </p>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {doctor.focus.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 rounded-[0.9rem] bg-[var(--bone)] px-4 py-3 text-[13.5px] font-medium text-[var(--ink)]">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                {dept && (
                  <p className="rounded-[0.9rem] bg-[var(--teal-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--teal-deep)]">
                    Done in-house on the day where possible: <b>{dept.common}</b>.
                  </p>
                )}
              </div>
            )}

            {tab === "At the clinic" && (
              <div className="space-y-5">
                <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                  <Fact k="Consulting hours" v={doctor.opd} mono />
                  <Fact k="Days" v={daysInWords(doctor.days)} />
                  <Fact k="Consultation fee" v={`₹${doctor.fee}, paid at the hospital`} />
                  <Fact k="Department" v={doctor.department} />
                </dl>
                <div className="border-t border-[var(--line)] pt-5">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">Where to go</p>
                  <p className="mt-2 text-[14px] leading-[1.7] text-[var(--ink-soft)]">{HOSPITAL.address}</p>
                  <p className="mt-3 text-[13.5px] leading-[1.7] text-[var(--muted)]">
                    Report to the front desk 10 minutes early. First visit? Bring a photo ID -
                    you'll be given a permanent Jeeva ID that carries all your records from then on.
                    Bring any previous prescriptions, scans or reports you already have.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── FAQs, alongside ────────────────────────────────────────────────── */}
      <section className="min-w-0 rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
        <div className="glass h-full min-w-0 rounded-[1.35rem] p-5 sm:p-6">
          <h3 className="display text-[19px] text-[var(--ink)]">Before you book</h3>
          <p className="mt-1 text-[12.5px] text-[var(--muted)]">
            The questions the front desk is asked most.
          </p>
          <div className="mt-4 space-y-2">
            {faqsFor(doctor).map((f) => (
              <details key={f.q} className="group rounded-[0.9rem] bg-white/80 ring-1 ring-black/5 transition-shadow open:shadow-[var(--shadow-sm)]">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
                  <span className="text-[13.5px] font-semibold leading-snug text-[var(--ink)]">{f.q}</span>
                  <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full border border-[var(--line-strong)] text-[var(--muted)] transition-transform duration-200 group-open:rotate-45 group-open:border-[var(--teal)] group-open:bg-[var(--teal)] group-open:text-white">
                    <Plus className="h-3 w-3" />
                  </span>
                </summary>
                <p className="px-4 pb-4 text-[12.5px] leading-[1.7] text-[var(--ink-soft)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">{k}</dt>
      <dd className={`mt-1 text-[14px] font-medium text-[var(--ink)] ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}

/** Written from the hospital's actual policies, with the doctor's own facts filled in. */
function faqsFor(d: Doctor): { q: string; a: string }[] {
  return [
    {
      q: "Do I have to pay to book?",
      a: `No. Booking is free and there is no online payment. The ₹${d.fee} consultation fee is paid at the hospital desk on the day.`,
    },
    {
      q: "What if I just walk in?",
      a: `Walk-ins are always seen. Booking only means you are not waiting - ${d.name.replace(/^Dr\.?\s*/, "Dr ")} consults ${daysInWords(d.days).toLowerCase()}, ${d.opd}.`,
    },
    {
      q: "How soon will I get my reports?",
      a: "Routine blood work comes back in about 30 minutes, so in most cases the doctor can go through the results with you in the same visit.",
    },
    {
      q: "Can I change or cancel the time?",
      a: `Yes - call the front desk on ${HOSPITAL.phone} and they will move it. Please give as much notice as you can so the slot goes to someone else.`,
    },
    {
      q: "What should I bring?",
      a: "A photo ID on your first visit, plus any previous prescriptions, scans or reports. You will be issued a permanent Jeeva ID that keeps your records together from then on.",
    },
    {
      q: "What about an emergency?",
      a: `Don't book - come straight in, or call ${HOSPITAL.emergency}. Emergency care runs 24×7 and does not need an appointment.`,
    },
  ];
}
