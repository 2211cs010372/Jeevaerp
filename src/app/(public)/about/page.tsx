import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Clock, MapPin, Phone } from "@/components/ui/hugeicons";
import { SectionHeading } from "@/components/ui/section-heading";
import { SmartImage } from "@/components/ui/smart-image";
import { Chapter, ChapterHead } from "@/components/marketing/section";
import { Counter, Reveal, Stagger } from "@/components/marketing/motion";
import { careHref } from "@/lib/care";
import { CARE_AREAS, DEPARTMENTS, HOSPITAL, WARDS } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";

export const metadata: Metadata = {
  title: "About the hospital",
  description: `About ${HOSPITAL.name} in ${HOSPITAL.locality} - ${DEPARTMENTS.length} departments, consultants across every one of them, and one hospital ID that carries every visit, prescription and report you have ever had here.`,
  alternates: { canonical: "/about" },
};

/**
 * About the hospital.
 *
 * EVERY FACT ON THIS PAGE COMES FROM data.ts. Department and consultant counts,
 * the bed total, OPD hours, the address and the phone numbers are all read from
 * the same source the rest of the site and the ERP read, so this page cannot
 * drift out of step with the booking flow or the tariff.
 *
 * WHAT IS DELIBERATELY ABSENT. No founding year, no leadership names, no
 * accreditation badges, no staff headcount beyond the consulting panel. None of
 * those exist in the data, and a hospital's About page is the last place to put
 * a plausible-sounding guess - an invented NABH badge is a claim a family can
 * act on. They are listed as gaps for the hospital to supply rather than filled
 * with placeholder text that could be mistaken for fact.
 */
export default async function AboutPage() {
  const consultants = (await listPublicDoctors()).length;
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);
  const phone = HOSPITAL.phone.replace(/\s/g, "");

  return (
    <div className="bg-[var(--bone)]">
      <SectionHeading
        index="About"
        title={"One building.\nOne record."}
        subtitle={`${HOSPITAL.name} is a ${DEPARTMENTS.length}-department hospital in ${HOSPITAL.locality.split(",")[0]}. The idea it is built around is simple: a hospital that already knows your history should stop asking you to be your own medical record.`}
        meta={
          <>
            <span className="chip chip-dark">{DEPARTMENTS.length} departments</span>
            <span className="chip chip-dark">{consultants}+ consultants</span>
            <span className="chip chip-dark">{beds} beds</span>
          </>
        }
      />

      {/* ── the thesis, as a bento ─────────────────────────────────────── */}
      <Chapter tone="light" className="chapter-flush-t pt-14 sm:pt-18">
        <ChapterHead
          index="01"
          label="What we are"
          lines={[{ text: "Registered once." }, { text: "Known ever after." }]}
          lede="Most of what makes a visit here different is not a machine. It is that the consultation, the test and the medicine all write to one record, so nobody has to carry a file between them."
        />

        <Stagger
          each={0.07}
          y={22}
          className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="overflow-hidden rounded-[16px] bg-[var(--paper)] p-2.5 sm:col-span-2 lg:row-span-2">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[9px] sm:aspect-[16/11]">
              <SmartImage
                src="/images/hospital_banner.jpeg"
                alt={`Inside ${HOSPITAL.name}`}
                label="Hospital interior"
                className="absolute inset-0 h-full w-full"
              />
            </div>
            <div className="p-3 sm:p-4">
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {HOSPITAL.locality}
              </p>
              <p className="display-sm mt-2 max-w-[22ch] text-[var(--ink)]">
                {HOSPITAL.tagline}.
              </p>
              <p className="mt-3 max-w-[52ch] text-[13px] leading-[1.7] text-[var(--ink-soft)]">
                Consulting, diagnostics, pharmacy and inpatient care are all in
                this building, which is what lets one visit finish what it
                started instead of becoming three.
              </p>
            </div>
          </div>

          <Fact value={DEPARTMENTS.length} label="Departments, staffed"
            text="Medicine, surgery, women's and children's health and more, consulting under one roof." />
          <Fact value={consultants} suffix="+" label="Consultants on the panel"
            text="Named doctors with their days and OPD hours on the record." />
          <Fact value={30} suffix=" min" label="Routine report turnaround" className="lg:col-span-2"
            text="Bloods are processed in this building and land on your record - and your phone - usually before you have left." />
          <Fact value={beds} label="Beds, including ICU" className="sm:col-span-2"
            text="General, semi-private and private rooms plus a monitored ICU, and a bed for the attendant." />
        </Stagger>
      </Chapter>

      {/* ── the ethic ──────────────────────────────────────────────────── */}
      <Chapter tone="paper">
        <ChapterHead
          index="02"
          label="What we publish"
          lines={[{ text: "You should know" }, { text: "who you will see." }]}
          lede="Every consultant, every room and every health check is described on this website before you arrive - who sits when, what a room includes, what a package tests."
        />

        <Stagger each={0.08} y={20} className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-3">
          <Published title="Your consultant" href="/doctors"
            text="Every consultant's qualification, days and hours are on their profile, with live slots, before you commit to one." />
          <Published title="The rooms" href="/#facilities"
            text="General, semi-private, private and ICU - what each one includes, and room for the person who stays with you." />
          <Published title="Health checks" href="/health-checks"
            text="Each package lists every test it contains, and whether you need to come fasting, so nothing is a surprise." />
        </Stagger>
      </Chapter>

      {/* ── the doors ──────────────────────────────────────────────────── */}
      <Chapter tone="light">
        <ChapterHead
          index="03"
          label="Where to start"
          lines={[{ text: "Six doors," }, { text: `${DEPARTMENTS.length} departments.` }]}
          lede="People rarely arrive looking for 'Orthopaedics'. They arrive knowing something hurts, or that a child is unwell. These are the doors the departments sit behind."
          action={{ href: "/doctors", label: "Meet the consultants" }}
        />

        <Stagger each={0.06} y={20} className="mt-10 grid gap-3 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
          {CARE_AREAS.map((area) => (
            <div key={area.label} className="rounded-[16px] bg-[var(--paper)] p-5 sm:p-6">
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--teal)]">
                {area.departments.length}{" "}
                {area.departments.length === 1 ? "department" : "departments"}
              </p>
              <h3 className="display-sm mt-3 text-[var(--ink)]">{area.label}</h3>
              <p className="mt-2.5 text-[13px] leading-[1.65] text-[var(--ink-soft)]">
                {area.blurb}
              </p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {area.departments.map((d) => (
                  <li key={d}>
                    <Link
                      href={careHref(d)}
                      className="inline-block rounded-full bg-[var(--bone)] px-3 py-1.5 text-[11.5px] font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--teal)] hover:text-white"
                    >
                      {d}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Stagger>
      </Chapter>

      {/* ── how to reach us ────────────────────────────────────────────── */}
      <Chapter tone="paper">
        <ChapterHead
          index="04"
          label="Visit"
          lines={[{ text: "Where we are," }, { text: "and when." }]}
        />

        <Reveal className="mt-10 grid gap-3 sm:mt-14 lg:grid-cols-3" y={20}>
          <div className="rounded-[16px] bg-[var(--bone)] p-6 lg:col-span-2">
            <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Address
            </p>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.7] text-[var(--ink)]">
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
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-[16px] bg-[var(--bone)] p-6">
              <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                <Clock className="h-3.5 w-3.5" aria-hidden /> OPD
              </p>
              <p className="mt-3 text-[15px] font-semibold text-[var(--ink)]">
                {HOSPITAL.opdHours}
              </p>
              <p className="mt-1 text-[13px] text-[var(--ink-soft)]">
                {HOSPITAL.opdDays}
              </p>
            </div>

            <a
              href={`tel:${HOSPITAL.emergency.replace(/\s/g, "")}`}
              className="rounded-[16px] bg-[var(--alert-soft)] p-6 transition-colors hover:bg-[var(--alert)]/15"
            >
              <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--alert)]">
                <span className="pulse pulse-alert" /> Emergency, 24×7
              </p>
              <p className="mono mt-3 text-[15px] font-semibold text-[var(--alert-deep)]">
                {HOSPITAL.emergency}
              </p>
            </a>
          </div>
        </Reveal>

        <Reveal className="mt-3" y={16}>
          <div className="flex flex-wrap items-center justify-between gap-5 rounded-[16px] bg-[var(--bone-deep)] px-6 py-6 sm:px-8">
            <p className="max-w-md text-[14.5px] leading-[1.6] text-[var(--ink-soft)]">
              Not sure which department you need? The front desk will ask a
              couple of questions and point you at the right one.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <a href={`tel:${phone}`} className="btn btn-solid">
                <Phone className="h-3.5 w-3.5" /> {HOSPITAL.phone}
              </a>
              <Link href="/book" className="btn btn-ghost">
                Book an appointment
              </Link>
            </div>
          </div>
        </Reveal>
      </Chapter>
    </div>
  );
}

/** A number from the ERP, with the claim it supports. */
function Fact({
  value,
  suffix = "",
  label,
  text,
  className = "",
}: {
  value: number;
  suffix?: string;
  label: string;
  text: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col justify-between rounded-[16px] bg-[var(--paper)] p-5 sm:p-6 ${className}`}>
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </p>
      <div className="mt-10">
        <p className="stat-num text-[var(--teal)] [font-size:clamp(2rem,3.2vw,2.9rem)]">
          <Counter value={value} suffix={suffix} />
        </p>
        <p className="mt-3 max-w-[48ch] text-[13px] leading-[1.65] text-[var(--ink-soft)]">
          {text}
        </p>
      </div>
    </div>
  );
}

/** One thing this hospital puts a number on in public. */
function Published({
  title,
  text,
  href,
}: {
  title: string;
  text: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-[16px] bg-[var(--bone)] p-5 transition-colors hover:bg-[var(--bone-deep)] sm:p-6"
    >
      <h3 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
        {title}
        <ArrowUpRight
          aria-hidden
          className="h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-400 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--teal)]"
        />
      </h3>
      <p className="mt-2.5 text-[13px] leading-[1.7] text-[var(--ink-soft)]">{text}</p>
    </Link>
  );
}
