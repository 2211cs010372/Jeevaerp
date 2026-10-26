import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Clock,
  HeartPulse,
  Phone,
  ShieldCheck,
  Stethoscope,
} from "@/components/ui/hugeicons";
import { SmartImage } from "@/components/ui/smart-image";
import { DeptIcon } from "@/components/marketing/dept-icon";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { OpdBand } from "@/components/marketing/opd-band";
import { Chapter, ChapterHead, Rule } from "@/components/marketing/section";
import { Parallax, Reveal, SplitLead, Stagger } from "@/components/marketing/motion";
import { DEPARTMENTS, HOSPITAL, type CareArea, type Department, type Doctor } from "@/lib/data";
import { careHref, slugify } from "@/lib/care";
import { daysInWords } from "@/lib/opd";
import { doctorHref } from "@/lib/doctors";

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
 *
 * The warning-signs panel is the one place on this site where the alert red is
 * allowed outside the emergency band, and it keeps the loudest treatment on
 * the page for exactly that reason.
 */
export function CarePage({
  dept,
  area,
  doctors,
}: {
  dept: Department;
  area?: CareArea;
  doctors: Doctor[];
}) {
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");
  const others = DEPARTMENTS.filter((d) => d.name !== dept.name);
  const lead = doctors[0];

  return (
    <div className="bg-[var(--bone)]">
      {/* ══ BANNER - full-bleed, the department photograph behind pine ════ */}
      <section className="relative isolate overflow-hidden below-nav pb-14 text-white lg:pb-20">
        <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
          <Parallax amount={12} className="absolute inset-0 h-[116%] -top-[8%]">
            <SmartImage
              src={dept.image}
              alt={dept.name}
              label={dept.name}
              className="h-full w-full object-cover"
            />
          </Parallax>
          {/* pine wash from the left so the type reads over any photo */}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--pine-ink)] via-[var(--pine-ink)]/88 to-[var(--pine-ink)]/45" />
        </div>

        <div className="shell-w">
          <Link
            href="/#specialities"
            className="mono inline-flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-white/60 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All departments
          </Link>

          <div className="mt-8 rule-row rule-row-dark">
            <span className="rule-idx">({dept.index})</span>
            <span className="rule-line" />
            <span className="rule-label">{area?.label ?? "Department"}</span>
          </div>

          <div className="mt-9 grid gap-x-12 gap-y-8 sm:mt-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
            <div className="flex items-start gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/12 text-white backdrop-blur">
                <DeptIcon name={dept.name} className="h-7 w-7" />
              </span>
              <SplitLead
                as="h1"
                immediate
                delay={0.08}
                className="display-lead text-white"
                lines={[{ text: dept.name }]}
              />
            </div>

            <div className="lg:pb-2">
              <Reveal as="p" delay={0.28} y={18} className="lede text-white/70">
                {dept.blurb}
              </Reveal>

              <Reveal delay={0.36} y={16} className="mt-7 flex flex-wrap gap-2.5">
                <Link
                  href={`/book?dept=${encodeURIComponent(dept.name)}`}
                  className="btn btn-light"
                >
                  Book an appointment <ArrowUpRight className="h-4 w-4" />
                </Link>
                <a href={`tel:${emergency}`} className="btn btn-ghost-dark">
                  <Phone className="h-4 w-4" /> Call 24×7
                </a>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ══ THE CONSULTANT - who you see, when, and what it costs ═════════ */}
      {lead && (
        <Chapter tone="paper" className="chapter-tight">
          <Rule label={doctors.length > 1 ? "Your consultants" : "Your consultant"} />

          <Stagger each={0.1} y={24} className="grid-lines mt-8">
            {doctors.map((doc) => (
              <div
                key={doc.id}
                className="grid gap-6 py-8 sm:grid-cols-[auto_1fr_auto] sm:items-center"
              >
                <DoctorAvatar
                  name={doc.name}
                  className="h-[112px] w-[112px] shrink-0 rounded-[var(--r-md)] text-[24px]"
                />

                <div className="min-w-0">
                  <h2 className="display-sm text-[var(--ink)]">{doc.name}</h2>
                  <p className="mt-1 text-[14px] font-medium text-[var(--teal)]">
                    {doc.specialization}
                  </p>
                  <p className="mono mt-1.5 text-[11.5px] uppercase tracking-[0.12em] text-[var(--muted)]">
                    {doc.qualification}
                  </p>

                  <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
                    <Fact
                      icon={<Clock className="h-3.5 w-3.5" />}
                      k="Consulting"
                      v={`${doc.opd} · ${daysInWords(doc.days)}`}
                    />
                    <Fact
                      icon={<Stethoscope className="h-3.5 w-3.5" />}
                      k="Experience"
                      v={`${doc.experience} years`}
                    />
                    <Fact
                      icon={<HeartPulse className="h-3.5 w-3.5" />}
                      k="Speaks"
                      v={doc.languages}
                    />
                  </dl>
                </div>

                {/* when they sit + the two ways to act on it. No fee here -
                    prices are not shown anywhere on the public site. */}
                <div className="shrink-0 rounded-[var(--r-md)] bg-[var(--pine-ink)] p-5 text-center text-white sm:w-[196px]">
                  <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-white/45">
                    Consults
                  </p>
                  <p className="mt-2 text-[15px] font-medium leading-snug text-white">{doc.days}</p>
                  <p className="mt-1 text-[10.5px] text-white/45">{doc.opd}</p>

                  <Link href={doctorHref(doc)} className="btn btn-light mt-4 w-full !px-4 !py-2.5 !text-[13px]">
                    See times &amp; book
                  </Link>
                  <a
                    href={`tel:${emergency}`}
                    className="btn btn-ghost-dark mt-2 w-full !px-4 !py-2 !text-[12px]"
                  >
                    <Phone className="h-3 w-3" /> Call to book
                  </a>
                </div>
              </div>
            ))}
          </Stagger>

          <Reveal className="mt-8" y={16}>
            <OpdBand opd={lead.opd} days={lead.days} variant="full" />
          </Reveal>
        </Chapter>
      )}

      {/* ══ ABOUT + SERVICES ══════════════════════════════════════════════ */}
      <Chapter tone="light">
        <ChapterHead
          index="01"
          label={`About ${dept.name.toLowerCase()}`}
          lines={[{ text: "What this clinic" }, { text: "is actually for." }]}
          align="stack"
        />

        <Reveal as="p" className="body-lg mt-8 max-w-3xl" y={20}>
          {dept.guidance.about}
        </Reveal>

        <Reveal className="mt-8" y={16}>
          <p className="inline-flex flex-wrap items-center gap-2.5 rounded-full bg-[var(--teal-soft)] px-5 py-3 text-[13px] leading-relaxed text-[var(--teal-deep)]">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            Done in-house, usually the same day: <b>{dept.common}</b>
          </p>
        </Reveal>

        <Rule label={`${dept.services.length} services`} className="mt-16" />

        <Stagger
          as="ul"
          each={0.04}
          y={18}
          className="mt-8 grid gap-x-10 border-t border-[var(--line-strong)] md:grid-cols-2"
        >
          {dept.services.map((s) => (
            <li key={s.name} className="border-b border-[var(--line)]">
              <Link
                href={`/book?dept=${encodeURIComponent(dept.name)}`}
                className="group flex h-full gap-4 py-5 transition-colors"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold tracking-[-0.02em] text-[var(--ink)] transition-colors group-hover:text-[var(--teal)]">
                    {s.name}
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-[1.65] text-[var(--muted)]">
                    {s.desc}
                  </span>
                </span>
                <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-[var(--line-strong)] transition-all duration-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--teal)]" />
              </Link>
            </li>
          ))}
        </Stagger>
      </Chapter>

      {/* ══ GUIDANCE - warning signs first, then prevention and self-care ═ */}
      <Chapter tone="paper">
        <ChapterHead
          index="02"
          label="Health guidance"
          lines={[{ text: "When to wait," }, { text: "and when not to." }]}
          align="stack"
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* the one that gets somebody to hospital in time */}
          <Reveal
            className="rounded-[var(--r-xl)] border border-[var(--alert)]/25 bg-[var(--alert-soft)] p-7 sm:p-9"
            y={26}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--alert)] text-white">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <h3 className="display-sm text-[var(--alert-deep)]">Come in straight away if</h3>
            </div>
            <p className="mt-4 text-[13.5px] leading-[1.7] text-[var(--alert-deep)]/80">
              Don&apos;t book an appointment for these. Come to emergency, or call{" "}
              <a href={`tel:${emergency}`} className="mono font-semibold underline">
                {HOSPITAL.emergency}
              </a>
              .
            </p>
            <ul className="mt-6 space-y-3 border-t border-[var(--alert)]/20 pt-6">
              {dept.guidance.warningSigns.map((w) => (
                <li
                  key={w}
                  className="flex gap-3 text-[14px] leading-[1.6] text-[var(--alert-deep)]"
                >
                  <span
                    className="mt-[8px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--alert)]"
                    aria-hidden
                  />
                  {w}
                </li>
              ))}
            </ul>
          </Reveal>

          <div className="space-y-4">
            <GuidanceCard
              title="Lowering the risk"
              hint="What actually makes a difference, not folklore."
              items={dept.guidance.prevention}
              delay={0.08}
            />
            <GuidanceCard
              title="Looking after yourself"
              hint="Alongside treatment - never instead of it."
              items={dept.guidance.selfCare}
              delay={0.16}
            />
          </div>
        </div>

        {/* the honest footnote */}
        <Reveal className="mt-4" y={16}>
          <p className="rounded-[var(--r-md)] border border-[var(--line-strong)] bg-[var(--bone)] px-6 py-5 text-[13px] leading-[1.75] text-[var(--muted)]">
            <b className="text-[var(--ink-soft)]">
              This page is general information, not a diagnosis.
            </b>{" "}
            It cannot account for your history, your medicines or your test results, and it
            is no substitute for being examined. If something here matches what you&apos;re
            experiencing, that is a reason to see a doctor - not a reason to treat yourself.
          </p>
        </Reveal>
      </Chapter>

      {/* ══ the other departments ═════════════════════════════════════════ */}
      <Chapter tone="light" className="chapter-tight">
        <Rule label="Other departments" />

        <Stagger
          each={0.04}
          y={18}
          className="mt-8 grid border-t border-[var(--line-strong)] sm:grid-cols-2 lg:grid-cols-4"
        >
          {others.map((d) => (
            <Link
              key={d.name}
              href={careHref(d.name)}
              className="group flex items-center gap-3.5 border-b border-[var(--line)] px-1 py-5 transition-colors hover:bg-[var(--paper)] sm:px-5 lg:border-l lg:first:border-l-0"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--teal-soft)] text-[var(--teal)]">
                <DeptIcon name={d.name} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  {d.name}
                </span>
                <span className="mono block truncate text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  {d.common}
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--line-strong)] transition-colors group-hover:text-[var(--teal)]" />
            </Link>
          ))}
        </Stagger>
      </Chapter>

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
              "@type": "MedicalProcedure",
              name: s.name,
              description: s.desc,
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
    </div>
  );
}

function Fact({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-[3px] text-[var(--teal)]" aria-hidden>
        {icon}
      </span>
      <span>
        <dt className="mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--muted)]">{k}</dt>
        <dd className="mt-0.5 text-[13px] font-medium text-[var(--ink)]">{v}</dd>
      </span>
    </div>
  );
}

function GuidanceCard({
  title,
  hint,
  items,
  delay,
}: {
  title: string;
  hint: string;
  items: string[];
  delay: number;
}) {
  return (
    <Reveal className="card p-7 sm:p-8" y={26} delay={delay}>
      <h3 className="display-sm text-[var(--ink)]">{title}</h3>
      <p className="mt-2 text-[12.5px] text-[var(--muted)]">{hint}</p>
      <ul className="mt-5 space-y-3 border-t border-[var(--line)] pt-5">
        {items.map((t) => (
          <li key={t} className="flex gap-3 text-[13.5px] leading-[1.6] text-[var(--ink-soft)]">
            <span
              className="mt-[8px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--teal)]"
              aria-hidden
            />
            {t}
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
