import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft, ArrowUpRight, Check, GraduationCap, MapPin, Phone, Plus,
} from "lucide-react";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DoctorCard } from "@/components/marketing/doctor-card";
import { DoctorIndex, type ProfileSection } from "@/components/marketing/doctor-index";
import { DoctorSlots } from "@/components/marketing/doctor-slots";
import { OpdBand } from "@/components/marketing/opd-band";
import { Chapter, Rule } from "@/components/marketing/section";
import { Counter, Reveal, SplitLead, Stagger } from "@/components/marketing/motion";
import { DEPARTMENTS, HOSPITAL, type Doctor } from "@/lib/data";
import { careHref } from "@/lib/care";
import { dailyHours, daysInWords, isByAppointment } from "@/lib/opd";

/**
 * The doctor profile, laid out as the reference site lays out an article.
 *
 * Its shape, in order: a title band carrying nothing but who this is; a hero
 * card that butts up into the band and answers the four questions a patient
 * has before they read a word (what it costs, how long they've practised, when
 * they sit, where to go); then a two-column reading shell - a sticky contents
 * rail on the left, and on the right the profile itself as a set of ruled
 * chapters rather than a set of tabs.
 *
 * WHY CHAPTERS AND NOT TABS. The previous version filed this under three tabs.
 * Tabs are right when a reader wants one of three things and knows which; they
 * are wrong here, because "what does she treat", "what will it cost" and "what
 * do I bring" are all questions the SAME person has, in sequence, and a tab
 * hides two of the three answers behind a click most people never make. A long
 * page with a contents rail keeps every answer findable and lets search engines
 * see the lot.
 *
 * WHAT IS STICKY. The contents rail, and only the contents rail - see
 * doctor-index.tsx. The booking panel gets a room of its own further down,
 * because a slot picker pinned inside a viewport-height rail loses its own
 * submit button off the bottom of the screen.
 */
export function DoctorProfile({
  doctor,
  peers,
  peersLabel,
}: {
  doctor: Doctor;
  peers: Doctor[];
  peersLabel: string;
}) {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const desk = HOSPITAL.phone.replace(/\s/g, "");
  const dept = DEPARTMENTS.find((d) => d.name === doctor.department);
  const surname = doctor.name.replace(/^Dr\.?\s*/, "Dr ");

  // An anaesthetist has no published OPD window, so `dailyHours` honestly
  // returns 0 - and a glance cell reading "0 hrs/day" beside a consultant's
  // face reads as "never available" rather than "booked a different way".
  const byAppointment = isByAppointment(doctor.opd);

  // Registrations, memberships, awards and papers are supplied by the
  // consultant, so the section exists only when there is something in it -
  // see the note on those fields in data.ts.
  const hasCredentials = Boolean(
    doctor.registration ||
    doctor.memberships?.length ||
    doctor.awards?.length ||
    doctor.publications?.length,
  );

  const sections: ProfileSection[] = [
    { id: "about", label: "About the practice" },
    { id: "training", label: "Education" },
    { id: "conditions", label: "Conditions treated" },
    { id: "procedures", label: "Procedures" },
    { id: "when", label: "When to book" },
    { id: "hours", label: "Consulting hours" },
    { id: "visit", label: "Your visit" },
    ...(hasCredentials ? [{ id: "credentials", label: "Credentials" }] : []),
    { id: "faq", label: "Questions" },
  ];

  return (
    <div className="bg-[var(--bone)]">
      {/* ══ TITLE BAND · who this is, and nothing else ═══════════════════ */}
      <section className="relative isolate overflow-hidden bg-[var(--pine-ink)] below-nav pb-[clamp(7rem,15vw,11rem)] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(115%_85%_at_18%_-10%,rgba(23,112,95,0.3),transparent_62%)]"
        />

        <div className="shell-w">
          <Link
            href="/doctors"
            className="mono inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All doctors
          </Link>

          <div className="mt-8 rule-row rule-row-dark">
            <span className="rule-idx">(dr)</span>
            <span className="rule-line" />
            <Link
              href={careHref(doctor.department)}
              className="rule-label transition-colors hover:text-white"
            >
              {doctor.department}
            </Link>
          </div>

          <SplitLead
            as="h1"
            immediate
            delay={0.08}
            className="display-lead mt-9 text-white sm:mt-12"
            lines={[{ text: doctor.name }]}
          />
          <Reveal as="p" delay={0.28} y={16} className="mt-4 text-[16px] font-medium text-[var(--teal-tint)]">
            {doctor.designation}
          </Reveal>

          {/* The reference's article meta row - category, read time, date.
              Here: the four facts that decide whether to read any further. */}
          <Reveal delay={0.34} y={14} className="mt-6 flex flex-wrap items-center gap-2">
            <span className="chip chip-dark">{doctor.qualification}</span>
            <span className="chip chip-dark">{doctor.experience} years in practice</span>
            <span className="chip chip-dark">Speaks {doctor.languages}</span>
            <span className="chip chip-dark">
              {doctor.fee > 0 ? `₹${doctor.fee} consultation` : "No consultation fee"}
            </span>
          </Reveal>
        </div>
      </section>

      {/* ══ HERO CARD · docks into the band, the way the reference's hero
             image butts into its title block ══════════════════════════════ */}
      <div className="shell-w relative z-10 -mt-[clamp(5rem,11vw,8.5rem)]">
        <Reveal className="grid gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" y={30}>
          <div className="rounded-[16px] bg-[var(--paper)] p-2.5">
            <DoctorAvatar
              name={doctor.name}
              image={doctor.image}
              eager
              className="aspect-[4/5] w-full rounded-[9px] text-[38px]"
            />
          </div>

          {/* The bento off the "Why Jeeva" chapter, verbatim: white cells on
              porcelain, 16px corners, no borders and no shadows - the value
              step between paper and bone is what draws the edge. Counted teal
              numerals for the figures, and the accent spent in exactly ONE
              filled cell, which is the rule that keeps the grid calm. */}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-2">
            <Glance
              label="Consultation fee"
              value={doctor.fee > 0 ? <Counter value={doctor.fee} immediate /> : "Nil"}
              prefix={doctor.fee > 0 ? "₹" : ""}
              note={
                doctor.fee > 0
                  ? "Paid at the hospital desk on the day. Nothing to pay to book."
                  : "No separate OPD fee - this clinic is billed with the procedure it belongs to."
              }
            />
            <Glance
              label="In practice"
              value={<Counter value={doctor.experience} immediate />}
              suffix=" yrs"
              note={`${doctor.qualification} · ${doctor.department}`}
            />
            <Glance
              label="At the desk"
              value={byAppointment ? "By arrangement" : `${dailyHours(doctor.opd)}`}
              suffix={byAppointment ? "" : " hrs/day"}
              small={byAppointment}
              note={`${daysInWords(doctor.days)} · ${doctor.opd}`}
            />
            <Glance
              label="Where to go"
              value={doctor.room.split("·").pop()?.trim() ?? doctor.room}
              small
              note={HOSPITAL.address}
              icon
            />

            {/* the one filled cell - the only place the accent is spent */}
            <div className="flex flex-col justify-between rounded-[16px] bg-[var(--teal)] p-5 sm:col-span-2 sm:p-6">
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">
                Ready when you are
              </p>
              <div className="mt-7 flex flex-wrap items-end justify-between gap-5">
                <p className="display-sm max-w-[20ch] text-white">
                  {byAppointment ? "Arranged around your surgery." : "Pick a time, give a number, done."}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <a href="#book" className="btn btn-light">
                    {byAppointment ? "How to book" : "Book an appointment"}
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                  <a href={`tel:${desk}`} className="btn btn-ghost-dark">
                    <Phone className="h-4 w-4" /> {HOSPITAL.phone}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>

      {/* ══ THE PROFILE · contents rail + ruled chapters ═════════════════ */}
      <Chapter tone="light" className="chapter-tight">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,190px)_minmax(0,1fr)] lg:gap-16">
          <DoctorIndex sections={sections} />

          <div className="min-w-0 space-y-14 sm:space-y-[4.75rem]">
            {/* ── about ─────────────────────────────────────────────────── */}
            <Part id="about" index="01" kicker="About the practice" title={`What ${surname} does`}>
              <div className="space-y-5">
                {doctor.about.map((para, i) => (
                  <Reveal
                    as="p"
                    key={para.slice(0, 24)}
                    y={16}
                    delay={i * 0.04}
                    className={
                      i === 0
                        ? "text-[17px] leading-[1.68] tracking-[-0.008em] text-[var(--ink)] sm:text-[18px]"
                        : "text-[15px] leading-[1.75] text-[var(--ink-soft)]"
                    }
                  >
                    {para}
                  </Reveal>
                ))}
              </div>

              <Reveal className="mt-8 rounded-[16px] bg-[var(--paper)] p-6" y={18}>
                <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                  Special interests
                </p>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {doctor.interests.map((it) => (
                    <li
                      key={it}
                      className="rounded-full bg-[var(--teal-soft)] px-4 py-2 text-[12.5px] font-medium text-[var(--teal-deep)]"
                    >
                      {it}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </Part>

            {/* ── education ─────────────────────────────────────────────── */}
            <Part
              id="training"
              index="02"
              kicker="Education"
              title="Qualifications, in plain words"
            >
              <Stagger as="ol" each={0.06} y={18} className="grid-lines">
                {doctor.education.map((e) => (
                  <li key={e.award} className="flex items-start gap-4 py-5 first:pt-0">
                    <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal)]">
                      <GraduationCap className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="mono block text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--ink)]">
                        {e.award}
                      </span>
                      <span className="mt-1.5 block text-[13.5px] leading-[1.65] text-[var(--ink-soft)]">
                        {e.note}
                      </span>
                    </span>
                  </li>
                ))}
              </Stagger>

              {!hasCredentials && (
                <p className="mt-6 text-[12.5px] leading-[1.7] text-[var(--muted)]">
                  Council registration, society memberships and published work are listed once the
                  consultant supplies them. We publish the degrees the hospital holds on record and
                  nothing beyond that.
                </p>
              )}
            </Part>

            {/* ── conditions ────────────────────────────────────────────── */}
            <Part
              id="conditions"
              index="03"
              kicker="Conditions treated"
              title="What this clinic sees"
            >
              <Stagger
                as="ul"
                each={0.03}
                y={14}
                className="grid gap-x-8 gap-y-0 sm:grid-cols-2"
              >
                {doctor.treats.map((t) => (
                  <li
                    key={t}
                    className="flex items-start gap-3 border-b border-[var(--line)] py-3.5 text-[14px] leading-snug text-[var(--ink)]"
                  >
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                    {t}
                  </li>
                ))}
              </Stagger>

              {dept && (
                <Reveal className="mt-8 rounded-[16px] bg-[var(--paper)] p-6 sm:p-7" y={18}>
                  <p className="text-[14px] leading-[1.7] text-[var(--ink-soft)]">{dept.blurb}</p>
                  <p className="mt-4 text-[12.5px] text-[var(--muted)]">
                    Usually done in-house on the day: <b className="text-[var(--ink)]">{dept.common}</b>.
                  </p>
                  <Link href={careHref(doctor.department)} className="link-arrow mt-6">
                    Everything {doctor.department.toLowerCase()} covers
                    <span className="link-arrow-dot">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </Reveal>
              )}
            </Part>

            {/* ── procedures ────────────────────────────────────────────── */}
            <Part
              id="procedures"
              index="04"
              kicker="Procedures"
              title="Procedures and services"
            >
              <Stagger as="dl" each={0.04} y={16} className="grid-lines">
                {doctor.procedures.map((p) => (
                  <div
                    key={p.name}
                    className="grid gap-1.5 py-5 first:pt-0 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:gap-8"
                  >
                    <dt className="text-[14.5px] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                      {p.name}
                    </dt>
                    <dd className="text-[13.5px] leading-[1.7] text-[var(--ink-soft)]">{p.desc}</dd>
                  </div>
                ))}
              </Stagger>
            </Part>

            {/* ── when to book ──────────────────────────────────────────── */}
            <Part
              id="when"
              index="05"
              kicker="When to book"
              title="Reasons to see this clinic"
            >
              <Stagger as="ul" each={0.045} y={16} className="space-y-2">
                {doctor.seeIf.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-3 rounded-[12px] bg-[var(--paper)] px-5 py-4 text-[14px] leading-[1.6] text-[var(--ink)]"
                  >
                    <span className="mt-[3px] grid h-4 w-4 flex-none place-items-center rounded-full bg-[var(--teal)] text-white">
                      <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
                    </span>
                    {s}
                  </li>
                ))}
              </Stagger>

              {/* The one thing on this page that must never be missed: some of
                  the lines above are reasons to come in, not reasons to book. */}
              <Reveal className="mt-4 rounded-[12px] bg-[var(--alert-soft)] px-5 py-4" y={16}>
                <p className="text-[13.5px] leading-[1.65] text-[var(--alert-deep)]">
                  <b>If it is an emergency, do not book.</b> Come straight to the hospital or call{" "}
                  <a href={`tel:${emergency}`} className="font-semibold underline underline-offset-2">
                    {HOSPITAL.emergency}
                  </a>
                  . Emergency care runs 24×7 and never needs an appointment.
                </p>
              </Reveal>
            </Part>

            {/* ── hours ─────────────────────────────────────────────────── */}
            <Part id="hours" index="06" kicker="Consulting hours" title="When they sit">
              <Reveal className="rounded-[16px] bg-[var(--paper)] p-6 sm:p-8" y={20}>
                <OpdBand opd={doctor.opd} days={doctor.days} variant="full" />
                <dl className="mt-8 grid gap-x-8 gap-y-5 border-t border-[var(--line)] pt-6 sm:grid-cols-2">
                  <Fact k="Days" v={daysInWords(doctor.days)} />
                  <Fact k="Hours" v={doctor.opd} mono />
                  <Fact k="Department" v={doctor.department} />
                  <Fact k="Room" v={doctor.room} />
                </dl>
              </Reveal>
              <p className="mt-4 text-[12.5px] leading-[1.7] text-[var(--muted)]">
                Walk-ins are always seen. Booking a slot only means you are not waiting for one.
              </p>
            </Part>

            {/* ── your visit ────────────────────────────────────────────── */}
            <Part id="visit" index="07" kicker="Your visit" title="What to bring, what happens">
              <Stagger as="ul" each={0.04} y={16} className="grid gap-2 sm:grid-cols-2">
                {doctor.prepare.map((p) => (
                  <li
                    key={p}
                    className="rounded-[12px] bg-[var(--paper)] px-5 py-4 text-[13.5px] leading-[1.6] text-[var(--ink-soft)]"
                  >
                    {p}
                  </li>
                ))}
              </Stagger>

              <Reveal className="mt-8" y={18}>
                <Rule label="On the day" />
                <ol className="mt-6 grid-lines">
                  {VISIT_STEPS.map((s) => (
                    <li key={s.k} className="flex items-start gap-5 py-4 first:pt-0">
                      <span className="mono flex-none pt-0.5 text-[10.5px] tracking-[0.1em] text-[var(--teal)]">
                        {s.k}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-[var(--ink)]">{s.t}</span>
                        <span className="mt-1 block text-[13px] leading-[1.65] text-[var(--ink-soft)]">
                          {s.d}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Reveal>

              <Reveal className="mt-8 rounded-[16px] bg-[var(--paper)] p-6 sm:p-7" y={18}>
                <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                  Where to go
                </p>
                <p className="mt-3 text-[14.5px] font-semibold text-[var(--ink)]">{doctor.room}</p>
                <p className="mt-1.5 text-[13.5px] leading-[1.7] text-[var(--ink-soft)]">
                  {HOSPITAL.address}
                </p>
                <a
                  href={HOSPITAL.mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="link-arrow mt-6"
                >
                  Open in maps
                  <span className="link-arrow-dot">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </a>
              </Reveal>
            </Part>

            {/* ── credentials · only when the consultant has supplied them ─ */}
            {hasCredentials && (
              <Part
                id="credentials"
                index="08"
                kicker="Credentials"
                title="Registration and recognition"
              >
                <div className="space-y-8">
                  {doctor.registration && (
                    <Detail label="Medical council registration">
                      <p className="mono text-[14px] text-[var(--ink)]">{doctor.registration}</p>
                    </Detail>
                  )}

                  {doctor.memberships?.length ? (
                    <Detail label="Professional memberships">
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {doctor.memberships.map((m) => (
                          <li key={m} className="text-[13.5px] leading-[1.6] text-[var(--ink-soft)]">
                            {m}
                          </li>
                        ))}
                      </ul>
                    </Detail>
                  ) : null}

                  {doctor.awards?.length ? (
                    <Detail label="Awards and honours">
                      <ul className="space-y-2">
                        {doctor.awards.map((a) => (
                          <li key={a} className="text-[13.5px] leading-[1.6] text-[var(--ink-soft)]">
                            {a}
                          </li>
                        ))}
                      </ul>
                    </Detail>
                  ) : null}

                  {doctor.publications?.length ? (
                    <Detail label="Published work">
                      <ol className="grid-lines">
                        {doctor.publications.map((p) => (
                          <li key={p.title} className="py-4 first:pt-0">
                            {p.url ? (
                              <a
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[14px] font-semibold leading-snug text-[var(--ink)] underline-offset-4 hover:text-[var(--teal)] hover:underline"
                              >
                                {p.title}
                              </a>
                            ) : (
                              <span className="text-[14px] font-semibold leading-snug text-[var(--ink)]">
                                {p.title}
                              </span>
                            )}
                            <span className="mono mt-1.5 block text-[11px] text-[var(--muted)]">
                              {p.where}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </Detail>
                  ) : null}
                </div>
              </Part>
            )}

            {/* ── faq ───────────────────────────────────────────────────── */}
            <Part
              id="faq"
              index={hasCredentials ? "09" : "08"}
              kicker="Questions"
              title="Before you book"
            >
              <div className="space-y-2">
                {faqsFor(doctor).map((f) => (
                  <details key={f.q} className="group rounded-[12px] bg-[var(--paper)]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6">
                      <span className="text-[14px] font-semibold leading-snug text-[var(--ink)]">
                        {f.q}
                      </span>
                      <span className="faq-chev">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </summary>
                    <p className="faq-body px-5 pb-5 text-[13.5px] leading-[1.75] text-[var(--ink-soft)] sm:px-6">
                      {f.a}
                    </p>
                  </details>
                ))}
              </div>
            </Part>
          </div>
        </div>
      </Chapter>

      {/* ══ BOOKING · a room of its own ══════════════════════════════════ */}
      <Chapter id="book" tone="dark" className="chapter-tight">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-16">
          <div className="min-w-0">
            <Rule label="Book" dark />
            {/* The panel to the right already says "Pick a time" in its own
                heading - so this one must not. Two headings a hand's width
                apart saying the same thing reads as a rendering fault. */}
            <SplitLead
              as="h2"
              className="display-lead mt-8 text-white"
              lines={
                byAppointment
                  ? [{ text: "Arranged by" }, { text: "the desk." }]
                  : [{ text: "Booked in a" }, { text: "minute." }]
              }
            />
            <Reveal as="p" delay={0.1} y={18} className="lede mt-6 text-white/70">
              {byAppointment ? (
                <>
                  This clinic has no online diary to publish - it is booked around the operation or
                  admission it belongs to, by the team looking after you.
                </>
              ) : (
                <>
                  Booking is free and there is no online payment. The{" "}
                  {doctor.fee > 0 ? `₹${doctor.fee} consultation fee is` : "consultation charges are"}{" "}
                  settled at the hospital desk on the day.
                </>
              )}
            </Reveal>

            <Stagger each={0.06} y={16} className="mt-10 space-y-3">
              {(byAppointment
                ? [
                    `${surname} is booked through the front desk and the treating team, not an online slot.`,
                    "Call and the desk will fix a time around the surgery or admission it belongs to.",
                    "There is no separate OPD consultation fee for this clinic.",
                  ]
                : [
                    `${surname} consults ${daysInWords(doctor.days).toLowerCase()}, ${doctor.opd.toLowerCase()}.`,
                    "Every time shown is a real, still-open slot in the hospital's own diary.",
                    "Arrive ten minutes early and quote your OP number at the desk.",
                  ]
              ).map((line) => (
                <p key={line} className="flex items-start gap-3 text-[14px] leading-[1.6] text-white/75">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal-lift)]" aria-hidden />
                  {line}
                </p>
              ))}
            </Stagger>

            <Reveal className="mt-10 flex flex-wrap items-center gap-3" y={16}>
              <a href={`tel:${desk}`} className="btn btn-ghost-dark">
                <Phone className="h-4 w-4" /> Call the desk · {HOSPITAL.phone}
              </a>
              <a href={`tel:${emergency}`} className="btn btn-alert">
                Emergency · 24×7
              </a>
            </Reveal>
          </div>

          <Reveal className="min-w-0" y={26}>
            <DoctorSlots
              doctorName={doctor.name}
              days={doctor.days}
              fee={doctor.fee}
              opd={doctor.opd}
            />
          </Reveal>
        </div>
      </Chapter>

      {/* ══ THE REST OF THE PANEL · the reference's "next" cards ═════════ */}
      {peers.length > 0 && (
        <Chapter tone="paper" className="chapter-tight">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0 flex-1">
              <Rule label={peersLabel} />
              <SplitLead
                as="h2"
                className="display-sm mt-7 text-[var(--ink)]"
                lines={[{ text: "Other consultants" }]}
              />
            </div>
            <Link href="/doctors" className="link-arrow">
              All doctors
              <span className="link-arrow-dot">
                <ArrowUpRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </div>

          <Stagger
            each={0.05}
            y={20}
            className="mt-9 grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {peers.map((p) => (
              <DoctorCard key={p.id} doctor={p} />
            ))}
          </Stagger>
        </Chapter>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One chapter of the profile. Opens on the same rule row every other section
 * of the site opens on, so a reader who has scrolled past two of them knows a
 * third has started without reading the label.
 *
 * The id lives on the plain <section>, not on a motion primitive: the contents
 * rail observes these elements, and an element whose opacity GSAP is still
 * animating is a bad thing to measure a reading position against.
 */
function Part({
  id,
  index,
  kicker,
  title,
  children,
}: {
  id: string;
  index: string;
  kicker: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-[calc(var(--nav-h)+1.5rem)]">
      <Reveal className="rule-row" y={12}>
        <span className="rule-idx">({index})</span>
        <span className="rule-line" />
        <span className="rule-label">{kicker}</span>
      </Reveal>
      <Reveal as="h2" delay={0.06} y={16} className="display-sm mt-7 text-[var(--ink)]">
        {title}
      </Reveal>
      <div className="mt-8">{children}</div>
    </section>
  );
}

/**
 * One glance cell - the "Why Jeeva" bento's Stat, in a consultant's colours.
 *
 * Same construction as trust.tsx on purpose: white on porcelain, no border and
 * no shadow, a counted teal numeral carrying the cell, and the explanation set
 * small and soft underneath. A patient who has scrolled the homepage has
 * already learnt to read this shape.
 */
function Glance({
  label,
  value,
  prefix = "",
  suffix = "",
  note,
  small = false,
  icon = false,
}: {
  label: string;
  value: ReactNode;
  prefix?: string;
  suffix?: string;
  note: string;
  /** For a cell whose "number" is words - a room, or "By arrangement". */
  small?: boolean;
  icon?: boolean;
}) {
  return (
    <div className="flex flex-col justify-between rounded-[16px] bg-[var(--paper)] p-5 sm:p-6">
      <p className="text-[10px] uppercase tracking-[0.05em] text-[var(--muted)]">{label}</p>

      <div className="mt-8">
        <p
          className={`stat-num text-[var(--teal)] ${
            small
              ? "[font-size:clamp(1.15rem,1.8vw,1.6rem)] leading-[1.2]"
              : "[font-size:clamp(2rem,3.2vw,2.9rem)]"
          }`}
        >
          {prefix}
          {value}
          {/* "hrs/day" at headline size would run the cell off its own edge */}
          {suffix && (
            <span className="ml-0.5 text-[0.4em] font-semibold tracking-[-0.01em]">{suffix}</span>
          )}
        </p>
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-[1.6] text-[var(--ink-soft)]">
          {icon && <MapPin className="mt-[3px] h-3.5 w-3.5 flex-none text-[var(--teal)]" />}
          {note}
        </p>
      </div>
    </div>
  );
}

/** A labelled fact inside a panel. */
function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="mono text-[10px] uppercase tracking-[0.14em] text-[var(--muted)]">{k}</dt>
      <dd className={`mt-1.5 text-[14px] font-medium text-[var(--ink)] ${mono ? "mono" : ""}`}>{v}</dd>
    </div>
  );
}

/** A sub-block inside the credentials chapter. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Reveal y={16}>
      <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-[var(--muted)]">{label}</p>
      <div className="mt-3.5">{children}</div>
    </Reveal>
  );
}

/**
 * The same five steps every OPD visit takes, written from the hospital's own
 * process rather than from a stock template. Identical for every consultant -
 * which is the point: nobody should have to guess how a different department
 * runs its desk.
 */
const VISIT_STEPS = [
  {
    k: "01",
    t: "Register at the front desk",
    d: "First visit? A photo ID gets you a permanent Jeeva ID that carries every visit, prescription and report you ever have here.",
  },
  {
    k: "02",
    t: "Vitals",
    d: "Height, weight, blood pressure and temperature, recorded before you go in.",
  },
  {
    k: "03",
    t: "The consultation",
    d: "History, examination, and only the tests that are worth doing today rather than a list to arrange elsewhere.",
  },
  {
    k: "04",
    t: "Tests, if they are needed",
    d: "Lab, X-ray and ultrasound are in this building. Routine blood work is back in about 30 minutes, so results are usually read out in the same visit.",
  },
  {
    k: "05",
    t: "Prescription and pharmacy",
    d: "Medicines dispensed in-house, with the follow-up date written on the slip before you leave.",
  },
];

/** Written from the hospital's actual policies, with this doctor's facts in. */
function faqsFor(d: Doctor): { q: string; a: string }[] {
  const surname = d.name.replace(/^Dr\.?\s*/, "Dr ");
  return [
    {
      q: "Do I have to pay to book?",
      a: d.fee > 0
        ? `No. Booking is free and there is no online payment. The ₹${d.fee} consultation fee is paid at the hospital desk on the day.`
        : "No. There is no online payment, and this consultant does not charge a separate OPD consultation fee - the work is billed with the procedure or admission it belongs to.",
    },
    {
      q: "What if I just walk in?",
      a: `Walk-ins are always seen. Booking only means you are not waiting - ${surname} consults ${daysInWords(d.days).toLowerCase()}, ${d.opd.toLowerCase()}.`,
    },
    {
      q: "Which languages can I be seen in?",
      a: `${surname} consults in ${d.languages}. If you would be more comfortable in another language, tell the front desk when you book and they will arrange for someone to sit in.`,
    },
    {
      q: "Where do I go once I have registered?",
      a: `${d.room}. The desk will point you to it, and your OP number is called from there.`,
    },
    {
      q: "How soon will I get my reports?",
      a: "Routine blood work comes back in about 30 minutes, so in most cases the doctor can go through the results with you in the same visit rather than at another one.",
    },
    {
      q: "Can I change or cancel the time?",
      a: `Yes - call the front desk on ${HOSPITAL.phone} and they will move it. Please give as much notice as you can, so the slot goes to someone else.`,
    },
    {
      q: "What should I bring?",
      a: `A photo ID on your first visit, plus any previous prescriptions, scans or reports. For this clinic specifically: ${d.prepare[0].charAt(0).toLowerCase()}${d.prepare[0].slice(1)}.`,
    },
    {
      q: "What about an emergency?",
      a: `Don't book - come straight in, or call ${HOSPITAL.emergency}. Emergency care runs 24×7 and does not need an appointment.`,
    },
  ];
}
