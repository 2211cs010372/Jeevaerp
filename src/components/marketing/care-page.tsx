import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Clock, HeartPulse, Phone, ShieldCheck, Stethoscope } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { SmartImage } from "@/components/ui/smart-image";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { DEPARTMENTS, HOSPITAL, type CareArea, type Department, type Doctor } from "@/lib/data";
import { careHref, slugify } from "@/lib/care";
import { daysInWords } from "@/lib/opd";

/**
 * A department page.
 *
 * Order is deliberate: banner, then who you'd see and what it costs, then what
 * the department treats, then the health guidance. Someone who already knows
 * they need this clinic gets the consultant and the fee immediately; someone
 * still working out whether their problem belongs here reads on.
 *
 * The guidance block leads with WARNING SIGNS rather than prevention, because
 * a person searching their symptoms at 11pm needs "come in now" before they
 * need "eat less salt". It ends with a plain note that none of it replaces
 * being seen.
 */
export function CarePage({
  dept, area, doctors,
}: { dept: Department; area?: CareArea; doctors: Doctor[] }) {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const others = DEPARTMENTS.filter((d) => d.name !== dept.name);
  const lead = doctors[0];

  return (
    <>
      {/* ══ BANNER - full-bleed, title inside, nothing around it ══════════ */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="absolute inset-0 -z-10">
          <SmartImage
            src={dept.image}
            alt={dept.name}
            label={dept.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* pine wash from the left so the type reads over any photo */}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--pine-ink)] via-[var(--pine-ink)]/85 to-[var(--pine-ink)]/45" />
        </div>

        <div className="mx-auto max-w-[1200px] px-5 pb-12 pt-[132px] lg:px-8 lg:pb-16 lg:pt-[150px]">
          <Link href="/#departments"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/60 transition-colors hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> All departments
          </Link>

          <div className="mt-5 flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/15 text-white backdrop-blur">
              <DeptIcon name={dept.name} className="h-6 w-6" />
            </span>
            {area && (
              <span className="rounded-full bg-white/15 px-3 py-1 text-[11.5px] font-semibold text-white backdrop-blur">
                {area.label}
              </span>
            )}
          </div>

          <h1 className="display mt-4 text-[clamp(2.1rem,5vw,3.4rem)] text-white">{dept.name}</h1>
          <p className="mt-3 max-w-xl text-[15.5px] leading-[1.7] text-white/75">{dept.blurb}</p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link href={`/book?dept=${encodeURIComponent(dept.name)}`}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-[14px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bone)]">
              Book an appointment <ArrowUpRight className="h-4 w-4" />
            </Link>
            <a href={`tel:${emergency}`}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-3 text-[14px] font-semibold text-white transition-colors hover:border-white/70">
              <Phone className="h-4 w-4" /> Call 24×7
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-5 pb-24 pt-8 lg:px-8">
        {/* ══ THE CONSULTANT - who you see, when, and what it costs ═══════ */}
        {lead && (
          <Reveal>
            <section className="rounded-[1.75rem] bg-[var(--peach-soft)] p-1.5 ring-1 ring-black/5">
              <div className="glass rounded-[1.35rem] p-5 sm:p-7">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--muted)]">
                  {doctors.length > 1 ? "Your consultants" : "Your consultant"}
                </p>

                <div className="mt-4 space-y-4">
                  {doctors.map((doc) => (
                    <div key={doc.id} className="grid gap-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
                      <DoctorAvatar name={doc.name} image={doc.image}
                        className="h-[104px] w-[104px] shrink-0 rounded-[1.1rem] text-[24px] shadow-[var(--shadow-sm)]" />

                      <div className="min-w-0">
                        <h2 className="display text-[22px] text-[var(--ink)]">{doc.name}</h2>
                        <p className="mt-0.5 text-[14px] font-medium text-[var(--teal)]">{doc.specialization}</p>
                        <p className="mt-1 text-[12.5px] text-[var(--muted)]">{doc.qualification}</p>

                        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                          <Fact icon={<Clock className="h-3.5 w-3.5" />} k="Consulting" v={`${doc.opd} · ${daysInWords(doc.days)}`} />
                          <Fact icon={<Stethoscope className="h-3.5 w-3.5" />} k="Experience" v={`${doc.experience} years`} />
                          <Fact icon={<HeartPulse className="h-3.5 w-3.5" />} k="Speaks" v={doc.languages} />
                        </dl>
                      </div>

                      {/* consultation charges + the two ways to act on them */}
                      <div className="shrink-0 rounded-[1.1rem] bg-[var(--pine-ink)] p-4 text-center text-white sm:w-[188px]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
                          Consultation
                        </p>
                        <p className="display mt-1 text-[30px] leading-none text-white">
                          <span className="align-top text-[15px] text-white/60">₹</span>{doc.fee}
                        </p>
                        <p className="mt-1 text-[10.5px] text-white/50">paid at the hospital</p>

                        <Link href={`/doctors/${doc.id}`}
                          className="mt-3 block rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--bone)]">
                          See times & book
                        </Link>
                        <a href={`tel:${emergency}`}
                          className="mt-1.5 flex items-center justify-center gap-1.5 rounded-full border border-white/25 px-4 py-2 text-[12px] font-medium text-white/85 transition-colors hover:border-white/60">
                          <Phone className="h-3 w-3" /> Call to book
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 border-t border-[var(--line)] pt-5">
                  <OpdBand opd={lead.opd} days={lead.days} variant="full" />
                </div>
              </div>
            </section>
          </Reveal>
        )}

        {/* ══ ABOUT - the fuller description ═══════════════════════════════ */}
        <Reveal delay={40}>
          <section className="mt-4 rounded-[1.75rem] bg-white p-6 ring-1 ring-black/5 sm:p-8">
            <h2 className="display text-[22px] text-[var(--ink)]">About {dept.name.toLowerCase()} at Jeeva</h2>
            <p className="mt-3 max-w-3xl text-[15px] leading-[1.8] text-[var(--ink-soft)]">{dept.guidance.about}</p>
            <p className="mt-5 inline-flex flex-wrap items-center gap-2 rounded-[0.9rem] bg-[var(--teal-soft)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--teal-deep)]">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Done in-house, usually the same day: <b>{dept.common}</b>
            </p>
          </section>
        </Reveal>

        {/* ══ SERVICES - now with a line each ═════════════════════════════ */}
        <Reveal delay={50}>
          <section className="mt-4 rounded-[1.75rem] bg-white p-6 ring-1 ring-black/5 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="display text-[22px] text-[var(--ink)]">What we treat here</h2>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                {dept.services.length} services
              </p>
            </div>
            <ul className="mt-5 grid gap-3 md:grid-cols-2">
              {dept.services.map((s) => (
                <li key={s.name}>
                  <Link href={`/book?dept=${encodeURIComponent(dept.name)}`}
                    className="group flex h-full gap-3 rounded-[1rem] bg-[var(--bone)] px-4 py-3.5 transition-colors hover:bg-[var(--teal-soft)]">
                    <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-[var(--ink)]">{s.name}</span>
                      <span className="mt-0.5 block text-[12.5px] leading-[1.6] text-[var(--muted)]">{s.desc}</span>
                    </span>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-transparent transition-colors group-hover:text-[var(--teal)]" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>

        {/* ══ GUIDANCE - warning signs first, then prevention and self-care ═ */}
        <Reveal delay={60}>
          <section className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            {/* the one that gets somebody to hospital in time */}
            <div className="rounded-[1.75rem] bg-[var(--alert-soft)] p-6 ring-1 ring-[var(--alert)]/20 sm:p-8">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--alert)] text-white">
                  <AlertTriangle className="h-4.5 w-4.5" />
                </span>
                <h2 className="display text-[21px] text-[var(--alert-deep)]">Come in straight away if</h2>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--alert-deep)]/80">
                Don&apos;t book an appointment for these. Come to emergency, or call{" "}
                <a href={`tel:${emergency}`} className="font-mono font-semibold underline">{HOSPITAL.emergency}</a>.
              </p>
              <ul className="mt-4 space-y-2.5">
                {dept.guidance.warningSigns.map((w) => (
                  <li key={w} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-[var(--alert-deep)]">
                    <span className="mt-[8px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--alert)]" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <GuidanceCard
                title="Lowering the risk"
                hint="What actually makes a difference, not folklore."
                items={dept.guidance.prevention}
              />
              <GuidanceCard
                title="Looking after yourself"
                hint="Alongside treatment - never instead of it."
                items={dept.guidance.selfCare}
              />
            </div>
          </section>
        </Reveal>

        {/* the honest footnote */}
        <Reveal delay={70}>
          <p className="mt-4 rounded-[1.1rem] border border-[var(--line-strong)] bg-[var(--bone)] px-5 py-4 text-[12.5px] leading-[1.7] text-[var(--muted)]">
            <b className="text-[var(--ink-soft)]">This page is general information, not a diagnosis.</b>{" "}
            It cannot account for your history, your medicines or your test results, and it is no
            substitute for being examined. If something here matches what you&apos;re experiencing,
            that is a reason to see a doctor - not a reason to treat yourself.
          </p>
        </Reveal>

        {/* ══ the other departments ════════════════════════════════════════ */}
        <Reveal delay={80}>
          <div className="mt-10">
            <p className="sec-index">Other departments</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {others.map((d) => (
                <Link key={d.name} href={careHref(d.name)} className="card card-hover group flex items-center gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
                    <DeptIcon name={d.name} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[var(--ink)]">{d.name}</span>
                    <span className="block truncate text-[11px] text-[var(--muted)]">{d.common}</span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--teal)]" />
                </Link>
              ))}
            </div>
          </div>
        </Reveal>
      </div>

      {/* structured data - a real clinical department, machine-readable */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MedicalClinic",
            name: `${dept.name} · ${HOSPITAL.name}`,
            description: dept.guidance.about,
            medicalSpecialty: dept.name,
            availableService: dept.services.map((s) => ({
              "@type": "MedicalProcedure", name: s.name, description: s.desc,
            })),
            address: {
              "@type": "PostalAddress",
              streetAddress: HOSPITAL.address,
              addressLocality: "Hanamkonda",
              addressRegion: "Telangana",
              postalCode: "506001",
              addressCountry: "IN",
            },
            telephone: HOSPITAL.phone,
            url: `/care/${slugify(dept.name)}`,
          }),
        }}
      />
    </>
  );
}

function Fact({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-[3px] text-[var(--teal)]" aria-hidden>{icon}</span>
      <span>
        <dt className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--muted)]">{k}</dt>
        <dd className="text-[12.5px] font-medium text-[var(--ink)]">{v}</dd>
      </span>
    </div>
  );
}

function GuidanceCard({ title, hint, items }: { title: string; hint: string; items: string[] }) {
  return (
    <div className="rounded-[1.75rem] bg-white p-6 ring-1 ring-black/5 sm:p-7">
      <h3 className="display text-[19px] text-[var(--ink)]">{title}</h3>
      <p className="mt-1 text-[12.5px] text-[var(--muted)]">{hint}</p>
      <ul className="mt-4 space-y-2.5">
        {items.map((t) => (
          <li key={t} className="flex gap-2.5 text-[13.5px] leading-[1.6] text-[var(--ink-soft)]">
            <span className="mt-[8px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]" aria-hidden />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
