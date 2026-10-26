import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Phone, Plus } from "@/components/ui/hugeicons";
import { DoctorCard, initials } from "@/components/marketing/doctor-card";
import { DoctorSlots } from "@/components/marketing/doctor-slots";
import { PosterIntro } from "@/components/marketing/poster-intro";
import { Reveal, Stagger } from "@/components/marketing/motion";
import { DEPARTMENTS, HOSPITAL, type Doctor } from "@/lib/data";
import { careHref } from "@/lib/care";
import { daysInWords, isByAppointment } from "@/lib/opd";
import { doctorImage } from "@/lib/speciality-images";

/**
 * The doctor profile, in the homepage's voice.
 *
 * Plain white, 1.5rem edges, Montserrat for reading and Instrument Serif for
 * anything that is a title. Top to bottom:
 *
 *   intro     the chapter opening every homepage section uses - department,
 *             the three facts that decide whether to read on, the bio, a
 *             Book button - and the consultant's name as the serif headline
 *   portrait  a 4:5 picture beside the facts on hairline rows: when they sit,
 *             hours, room, languages
 *   chapters  each a ruled row, a small index and label on the left and a
 *             serif title over the content on the right, present only when
 *             there is something real to put in it
 *   book      a bone room of its own with the live slot picker
 *   others    the rest of the department, as the homepage's cards
 *
 * WHY SECTIONS APPEAR AND DISAPPEAR. The panel is read from the ERP, and the
 * ERP holds no procedures or biography for anybody - the array that used to
 * supply them was written by hand for consultants who never saw it. A heading
 * over an empty list reads as a page that failed to load, so a chapter exists
 * only when it has content, and the numbering is derived so it never skips.
 *
 * THE PICTURE is the consultant's own photo when one is uploaded (Admin -> HR),
 * and their speciality's photograph until then, with their monogram on it -
 * never a stock face. See lib/speciality-images.ts.
 *
 * No fee anywhere. Booking is free; charges are settled at the desk.
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
  const img = doctorImage(doctor);

  // An anaesthetist has no published OPD window - booked around the surgery,
  // not through a slot - and the page says so instead of showing an empty diary.
  const byAppointment = isByAppointment(doctor.opd);

  // Registrations, memberships, awards and papers are supplied by the
  // consultant, so the chapter exists only when there is something in it.
  const hasCredentials = Boolean(
    doctor.registration || doctor.memberships?.length || doctor.awards?.length || doctor.publications?.length,
  );

  const shows = {
    about: doctor.about.length > 0,
    training: doctor.education.length > 0,
    conditions: doctor.treats.length > 0,
    procedures: doctor.procedures.length > 0,
    when: doctor.seeIf.length > 0,
    visit: doctor.prepare.length > 0,
    credentials: hasCredentials,
    faq: true,
  };
  const order = (Object.keys(shows) as (keyof typeof shows)[]).filter((k) => shows[k]);
  const idx = (k: keyof typeof shows) => String(order.indexOf(k) + 1).padStart(2, "0");

  const facts: { k: string; v: ReactNode }[] = [
    { k: "Consults", v: byAppointment ? "By arrangement with the desk" : daysInWords(doctor.days) },
    { k: "Hours", v: doctor.opd },
    { k: "Where to go", v: doctor.room },
    { k: "Languages", v: doctor.languages },
    { k: "Qualification", v: doctor.qualification },
  ];

  return (
    <div className="f-sans bg-white">
      {/* ══ INTRO ═══════════════════════════════════════════════════════ */}
      <section className="px-[1.5rem] pt-[calc(var(--nav-h)+1.5rem)]">
        <Link
          href="/doctors"
          className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All doctors
        </Link>

        <PosterIntro
          as="h1"
          index="Dr"
          label={doctor.department}
          aside={[
            doctor.qualification,
            doctor.experience > 0 ? `${doctor.experience} years in practice` : "On the panel",
            `Speaks ${doctor.languages}`,
          ]}
          lede={doctor.bio || dept?.blurb || `${surname} consults at ${HOSPITAL.name}.`}
          action={{ href: "#book", label: byAppointment ? "How to book" : "Book an appointment" }}
          lines={[{ text: doctor.name }, { text: doctor.designation, className: "italic text-[var(--teal)]" }]}
        />
      </section>

      {/* ══ PORTRAIT + FACTS ════════════════════════════════════════════ */}
      <section className="px-[1.5rem] pt-[clamp(2rem,4vw,3rem)]">
        <div className="grid gap-6 md:grid-cols-12">
          <Reveal y={20} className="md:col-span-5 lg:col-span-4">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[12px] bg-[var(--bone)]">
              {img.own ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.src} alt={doctor.name} className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                <Image
                  src={img.src}
                  alt=""
                  fill
                  priority
                  sizes="(min-width: 1024px) 32vw, (min-width: 768px) 40vw, 100vw"
                  className="object-cover"
                />
              )}
              <span className="absolute left-3 top-3 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] backdrop-blur">
                {doctor.department}
              </span>
              {!img.own && (
                <span
                  aria-hidden
                  className="f-serif absolute bottom-3 left-3 grid h-12 w-12 place-items-center rounded-full bg-white text-[19px] text-[var(--ink)]"
                >
                  {initials(doctor.name)}
                </span>
              )}
            </div>
          </Reveal>

          <div className="flex flex-col justify-between gap-8 md:col-span-7 lg:col-span-8">
            <Stagger as="dl" each={0.05} y={12} className="border-b border-[var(--line-strong)]">
              {facts.map((f) => (
                <div key={f.k} className="grid grid-cols-[7.5rem_1fr] gap-4 border-t border-[var(--line-strong)] py-4 sm:grid-cols-[10rem_1fr]">
                  <dt className="text-[12px] font-medium text-[var(--muted)]">{f.k}</dt>
                  <dd className="text-[14px] font-medium leading-[1.3] text-[var(--ink)]">{f.v}</dd>
                </div>
              ))}
            </Stagger>

            <Reveal y={12} className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <p className="f-serif text-[clamp(1.5rem,2.2vw,2rem)] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
                {byAppointment ? (
                  <>
                    Arranged <span className="italic text-[var(--muted)]">around your surgery.</span>
                  </>
                ) : (
                  <>
                    Pick a time, <span className="italic text-[var(--muted)]">give a number.</span>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <a href="#book" className="btn-ghost-sm">
                  {byAppointment ? "How to book" : "Book an appointment"} <ArrowUpRight size={14} />
                </a>
                <a href={`tel:${desk}`} className="btn-ghost-sm">
                  <Phone className="h-3.5 w-3.5" /> {HOSPITAL.phone}
                </a>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══ CHAPTERS ════════════════════════════════════════════════════ */}
      <div className="space-y-[clamp(3rem,6vw,4.5rem)] px-[1.5rem] py-[clamp(3.5rem,7vw,6rem)]">
        {shows.about && (
          <Part id="about" index={idx("about")} label="About the practice" title={`What ${surname} does`}>
            <div className="space-y-4">
              {doctor.about.map((para, i) => (
                <p
                  key={para.slice(0, 24)}
                  className={
                    i === 0
                      ? "max-w-[62ch] text-[16px] font-medium leading-[1.4] text-[var(--ink)]"
                      : "max-w-[62ch] text-[14px] leading-[1.55] text-[var(--ink-soft)]"
                  }
                >
                  {para}
                </p>
              ))}
            </div>
            {doctor.interests.length > 0 && (
              <ul className="mt-6 flex flex-wrap gap-1.5">
                {doctor.interests.map((it) => (
                  <li key={it} className="rounded-full bg-[var(--bone)] px-3 py-1 text-[12.5px] font-medium text-[var(--ink)]">
                    {it}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        )}

        {shows.training && (
          <Part id="training" index={idx("training")} label="Education" title="Qualifications, in plain words">
            <Rows>
              {doctor.education.map((e) => (
                <li key={e.award} className="grid gap-1 border-t border-[var(--line-strong)] py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
                  <span className="f-serif text-[1.35rem] leading-[1.05] text-[var(--ink)]">{e.award}</span>
                  {e.note && <span className="text-[13.5px] leading-[1.45] text-[var(--ink-soft)]">{e.note}</span>}
                </li>
              ))}
            </Rows>
            {!hasCredentials && (
              <p className="mt-4 max-w-[62ch] text-[12.5px] font-medium leading-[1.45] text-[var(--muted)]">
                Council registration, society memberships and published work are listed once the consultant
                supplies them. We publish the degrees the hospital holds on record and nothing beyond that.
              </p>
            )}
          </Part>
        )}

        {shows.conditions && (
          <Part id="conditions" index={idx("conditions")} label="Conditions treated" title="What this clinic sees">
            <ul className="grid gap-x-8 sm:grid-cols-2">
              {doctor.treats.map((t) => (
                <li key={t} className="flex items-start gap-3 border-t border-[var(--line-strong)] py-3 text-[14px] font-medium leading-snug text-[var(--ink)]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
            {dept && (
              <div className="mt-6 rounded-[12px] bg-[var(--bone)] p-5 sm:p-6">
                <p className="max-w-[62ch] text-[14px] leading-[1.5] text-[var(--ink-soft)]">{dept.blurb}</p>
                <p className="mt-3 text-[12.5px] font-medium text-[var(--muted)]">
                  Usually done in-house on the day: <span className="text-[var(--ink)]">{dept.common}</span>.
                </p>
                <Link href={careHref(doctor.department)} className="btn-ghost-sm mt-4">
                  Everything {doctor.department.toLowerCase()} covers <ArrowUpRight size={14} />
                </Link>
              </div>
            )}
          </Part>
        )}

        {shows.procedures && (
          <Part id="procedures" index={idx("procedures")} label="Procedures" title="Procedures and services">
            <Rows>
              {doctor.procedures.map((p) => (
                <li key={p.name} className="grid gap-1 border-t border-[var(--line-strong)] py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                  <span className="f-serif text-[1.3rem] leading-[1.05] text-[var(--ink)]">{p.name}</span>
                  <span className="text-[13.5px] leading-[1.45] text-[var(--ink-soft)]">{p.desc}</span>
                </li>
              ))}
            </Rows>
          </Part>
        )}

        {shows.when && (
          <Part id="when" index={idx("when")} label="When to book" title="Reasons to see this clinic">
            <Rows>
              {doctor.seeIf.map((s) => (
                <li key={s} className="flex items-start gap-3 border-t border-[var(--line-strong)] py-3 text-[14px] font-medium leading-snug text-[var(--ink)]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                  {s}
                </li>
              ))}
            </Rows>
            {/* the one thing on this page that must never be missed: some of
                the lines above are reasons to come in, not reasons to book */}
            <p className="mt-4 rounded-[12px] bg-[var(--alert-soft)] px-5 py-4 text-[13.5px] font-medium leading-[1.45] text-[var(--alert-deep)]">
              If it is an emergency, do not book. Come straight in or call{" "}
              <a href={`tel:${emergency}`} className="underline underline-offset-2">
                {HOSPITAL.emergency}
              </a>{" "}
              - emergency care runs 24×7 and never needs an appointment.
            </p>
          </Part>
        )}

        {shows.visit && (
          <Part id="visit" index={idx("visit")} label="Your visit" title="What to bring, what happens">
            <Rows>
              {doctor.prepare.map((p) => (
                <li key={p} className="flex items-start gap-3 border-t border-[var(--line-strong)] py-3 text-[14px] font-medium leading-snug text-[var(--ink)]">
                  <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                  {p}
                </li>
              ))}
            </Rows>

            <p className="mt-8 text-[12px] font-medium text-[var(--muted)]">On the day</p>
            <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {VISIT_STEPS.map((s) => (
                <li key={s.k} className="flex flex-col gap-6 rounded-[12px] bg-[var(--bone)] p-4">
                  <span className="f-serif text-[2.2rem] leading-[0.8] text-[var(--teal)]">{s.k}</span>
                  <span>
                    <span className="f-serif block text-[1.2rem] leading-[1.05] text-[var(--ink)]">{s.t}</span>
                    <span className="mt-1.5 block text-[12.5px] leading-[1.35] text-[var(--ink-soft)]">{s.d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Part>
        )}

        {hasCredentials && (
          <Part id="credentials" index={idx("credentials")} label="Credentials" title="Registration and recognition">
            <div className="space-y-6">
              {doctor.registration && (
                <Detail label="Medical council registration">
                  <p className="text-[14px] font-medium text-[var(--ink)]">{doctor.registration}</p>
                </Detail>
              )}
              {doctor.memberships?.length ? (
                <Detail label="Professional memberships">
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {doctor.memberships.map((m) => (
                      <li key={m} className="text-[13.5px] leading-[1.45] text-[var(--ink-soft)]">{m}</li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {doctor.awards?.length ? (
                <Detail label="Awards and honours">
                  <ul className="space-y-1.5">
                    {doctor.awards.map((a) => (
                      <li key={a} className="text-[13.5px] leading-[1.45] text-[var(--ink-soft)]">{a}</li>
                    ))}
                  </ul>
                </Detail>
              ) : null}
              {doctor.publications?.length ? (
                <Detail label="Published work">
                  <Rows>
                    {doctor.publications.map((p) => (
                      <li key={p.title} className="border-t border-[var(--line-strong)] py-3">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer" className="text-[14px] font-medium text-[var(--ink)] hover:text-[var(--teal)] hover:underline">
                            {p.title}
                          </a>
                        ) : (
                          <span className="text-[14px] font-medium text-[var(--ink)]">{p.title}</span>
                        )}
                        <span className="mt-1 block text-[12px] text-[var(--muted)]">{p.where}</span>
                      </li>
                    ))}
                  </Rows>
                </Detail>
              ) : null}
            </div>
          </Part>
        )}

        <Part id="faq" index={idx("faq")} label="Questions" title="Before you book">
          <div className="border-b border-[var(--line-strong)]">
            {faqsFor(doctor).map((f) => (
              <details key={f.q} className="group border-t border-[var(--line-strong)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4">
                  <span className="f-serif text-[clamp(1.15rem,1.6vw,1.35rem)] leading-[1.1] text-[var(--ink)] transition-colors group-open:text-[var(--teal)]">
                    {f.q}
                  </span>
                  <span className="faq-chev" aria-hidden>
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                </summary>
                <p className="faq-body max-w-[62ch] pb-5 pr-10 text-[13.5px] font-medium leading-[1.45] text-[var(--ink-soft)]">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </Part>
      </div>

      {/* ══ BOOK · a bone room of its own ═══════════════════════════════ */}
      <section id="book" className="scroll-mt-[var(--nav-h)] bg-[var(--bone)] px-[1.5rem] py-[clamp(3.5rem,7vw,6rem)]">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="text-[12.5px] font-medium text-[var(--muted)]">(Book) {doctor.name}</p>
            <h2 className="f-serif mt-4 text-[clamp(2.4rem,4.4vw,4rem)] leading-[0.95] tracking-[-0.02em] text-[var(--ink)]">
              {byAppointment ? (
                <>
                  Arranged by <span className="italic text-[var(--teal)]">the desk.</span>
                </>
              ) : (
                <>
                  Booked in <span className="italic text-[var(--teal)]">a minute.</span>
                </>
              )}
            </h2>
            <p className="mt-4 max-w-[44ch] text-[14px] font-medium leading-[1.3] text-[var(--ink)]">
              {byAppointment
                ? "This clinic has no online diary - it is booked around the operation or admission it belongs to, by the team looking after you."
                : "Booking is free and there is no online payment. Consultation charges are settled at the hospital desk on the day."}
            </p>

            <ul className="mt-6 max-w-[52ch] border-b border-[var(--line-strong)]">
              {(byAppointment
                ? [
                    `${surname} is booked through the front desk and the treating team, not an online slot.`,
                    "Call and the desk will fix a time around the surgery or admission it belongs to.",
                    "Charges for this clinic are explained by the desk when the time is fixed.",
                  ]
                : [
                    `${surname} consults ${daysInWords(doctor.days).toLowerCase()}, ${doctor.opd.toLowerCase()}.`,
                    "Every time shown is a real, still-open slot in the hospital's own diary.",
                    "Arrive ten minutes early and quote your OP number at the desk.",
                  ]
              ).map((line) => (
                <li key={line} className="border-t border-[var(--line-strong)] py-3 text-[13.5px] font-medium leading-[1.35] text-[var(--ink-soft)]">
                  {line}
                </li>
              ))}
            </ul>

            <div className="mt-6 flex flex-wrap gap-2">
              <a href={`tel:${desk}`} className="btn-ghost-sm">
                <Phone className="h-3.5 w-3.5" /> Call the desk · {HOSPITAL.phone}
              </a>
              <a href={`tel:${emergency}`} className="btn-ghost-sm border-[var(--alert)]/40 text-[var(--alert)] hover:border-[var(--alert)]">
                <span className="pulse pulse-alert" aria-hidden /> Emergency 24×7
              </a>
            </div>
          </div>

          <Reveal className="min-w-0 lg:col-span-6" y={20}>
            <DoctorSlots doctorName={doctor.name} days={doctor.days} opd={doctor.opd} />
          </Reveal>
        </div>
      </section>

      {/* ══ THE REST OF THE PANEL ═══════════════════════════════════════ */}
      {peers.length > 0 && (
        <section className="px-[1.5rem] py-[clamp(3.5rem,7vw,6rem)]">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[12.5px] font-medium text-[var(--muted)]">{peersLabel}</p>
              <h2 className="f-serif mt-3 text-[clamp(2rem,3.6vw,3.2rem)] leading-[0.95] tracking-[-0.02em] text-[var(--ink)]">
                Other <span className="italic text-[var(--teal)]">consultants.</span>
              </h2>
            </div>
            <Link href="/doctors" className="btn-ghost-sm">
              All doctors <ArrowUpRight size={14} />
            </Link>
          </div>

          <Stagger each={0.05} y={18} className="mx-auto mt-6 grid max-w-[1180px] grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {peers.map((p) => (
              <DoctorCard key={p.id} doctor={p} />
            ))}
          </Stagger>
        </section>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * One chapter of the profile: a hairline across the page, the index and label
 * small in the left quarter, a serif title and the content in the rest. The
 * same rhythm as the homepage FAQ, so a visitor who has scrolled the homepage
 * already knows how to read it. The id lives on the plain <section> so an
 * in-page link lands on a stable element, not one GSAP is still animating.
 */
function Part({
  id,
  index,
  label,
  title,
  children,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid scroll-mt-[calc(var(--nav-h)+1rem)] gap-4 border-t border-[var(--line-strong)] pt-5 md:grid-cols-12 md:gap-6">
      <p className="text-[12.5px] font-medium text-[var(--muted)] md:col-span-3">
        ({index}) {label}
      </p>
      <Reveal y={14} className="min-w-0 md:col-span-9">
        <h2 className="f-serif text-[clamp(1.8rem,3vw,2.6rem)] leading-[1] tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
        <div className="mt-6">{children}</div>
      </Reveal>
    </section>
  );
}

/** A hairline-ruled list; each child draws its own top rule. */
function Rows({ children }: { children: ReactNode }) {
  return <ul className="border-b border-[var(--line-strong)]">{children}</ul>;
}

/** A sub-block inside the credentials chapter. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[var(--muted)]">{label}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/**
 * The same five steps every OPD visit takes, written from the hospital's own
 * process. Identical for every consultant - which is the point: nobody should
 * have to guess how a different department runs its desk.
 */
const VISIT_STEPS = [
  {
    k: "01",
    t: "Register",
    d: "First visit? A photo ID gets you a permanent Jeeva ID that carries every visit, prescription and report.",
  },
  { k: "02", t: "Vitals", d: "Height, weight, blood pressure and temperature, recorded before you go in." },
  {
    k: "03",
    t: "Consultation",
    d: "History, examination, and only the tests worth doing today rather than a list to arrange elsewhere.",
  },
  {
    k: "04",
    t: "Tests, if needed",
    d: "Lab, X-ray and ultrasound are in this building. Routine bloods are back in about 30 minutes.",
  },
  {
    k: "05",
    t: "Pharmacy",
    d: "Medicines dispensed in-house, with the follow-up date written on the slip before you leave.",
  },
];

/** Written from the hospital's actual policies, with this doctor's facts in. */
function faqsFor(d: Doctor): { q: string; a: string }[] {
  const surname = d.name.replace(/^Dr\.?\s*/, "Dr ");
  return [
    {
      q: "Do I have to pay to book?",
      a: "No. Booking is free and there is no online payment. Consultation charges are settled at the hospital desk on the day.",
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
