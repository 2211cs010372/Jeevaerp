import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DEPARTMENTS, DOCTORS, HOSPITAL } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Counter, Reveal, Stagger } from "./motion";

/**
 * Chapter 01 - the opening claim, as a bento.
 *
 * Four numbers and a photograph, laid out as cells of different weights so the
 * eye is told what to read first without anything being made louder. The
 * numbers are all things the ERP behind this site can actually prove: how many
 * departments are staffed, how many consultants sit in them, how fast the lab
 * turns routine bloods around, and the one hospital ID that ties the lot
 * together. Nothing here is a round number chosen because it looked confident.
 *
 * THE CARD IDIOM IS BORROWED, THE COLOUR IS NOT. White cells on the porcelain
 * ground, no borders and no shadows - separation comes from the value step
 * between paper and bone, which is how the reference site does it and why it
 * reads as calm at a glance. The photograph sits inset inside its cell rather
 * than bleeding to the edge, which is the detail that makes the grid read as
 * one object instead of a photo with boxes next to it.
 *
 * Red Hat Display used to be pinned to this chapter by overriding
 * --font-display on its root. It is now the whole public site's display face,
 * set once on `.site` in site-theme.css, so the local override has gone - it
 * would only have been a second place to change the same thing.
 */

export function Trust() {
  const faces = DOCTORS.slice(0, 4);
  const rest = Math.max(0, DOCTORS.length - faces.length);

  return (
    <Chapter id="why" tone="light">
      {/* leading pulled in tight - Red Hat Display sets on a shorter body than
          the default face, and 0.94 leaves the two lines drifting apart */}
      <ChapterHead
        index="01"
        label="Why Jeeva"
        lines={[{ text: "Care that" }, { text: "remembers you." }]}
        lede="A hospital that already knows your history is a hospital that stops asking you to be your own medical record. That is the whole idea, and everything below is what it takes to keep the promise."
        action={{ href: "/doctors", label: "Meet the consultants" }}
        className="[&_.display-lead]:leading-[0.82] [&_.display-lead]:tracking-[-0.03em]"
      />

      <Stagger
        each={0.07}
        y={22}
        className="mt-9 grid gap-3 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* the building - two cells wide, two deep, and the only photograph */}
        <Cell className="sm:col-span-2 lg:row-span-2">
          <figure className="flex h-full flex-col">
            <div className="relative flex-1 overflow-hidden rounded-[9px] max-sm:aspect-[4/3] sm:min-h-[19rem]">
              <SmartImage
                src="/images/hospital_banner.jpeg"
                alt={`Inside ${HOSPITAL.name}`}
                label="Hospital interior"
                className="absolute inset-0 h-full w-full"
              />
            </div>

            <figcaption className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  {HOSPITAL.locality}
                </p>
                <p className="display-sm mt-2 max-w-[20ch] text-[var(--ink)]">
                  One building. One record. One ID for life.
                </p>
              </div>

              {/* who is actually in the building today */}
              <span className="flex -space-x-2.5">
                {faces.map((d) => (
                  <DoctorAvatar
                    key={d.id}
                    name={d.name}
                    image={d.image}
                    className="h-9 w-9 rounded-full border-2 border-[var(--paper)] text-[9px]"
                  />
                ))}
                {rest > 0 && (
                  <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--paper)] bg-[var(--teal)] text-[10px] font-semibold text-white">
                    +{rest}
                  </span>
                )}
              </span>
            </figcaption>
          </figure>
        </Cell>

        <Stat
          value={DEPARTMENTS.length}
          label="Departments, staffed"
          title="Most referrals never leave the building."
          text="Medicine, surgery, women's and children's health and more, consulting under one roof."
          className = "p-5 sm:p-6"
        />

        <Stat
          value={DOCTORS.length}
          suffix="+"
          label="Consultants on the panel"
          title="You know who you are seeing before you book."
          text="Named doctors with published fees, days and OPD hours. No pooled queue."
          className = "p-5 sm:p-6"
        />

        {/* the widest claim gets the widest cell */}
        <Stat
          className="lg:col-span-2 p-5 sm:p-6"
          value={30}
          suffix=" min"

          label="Routine report turnaround"
          title="Bloods drawn in the morning are read before lunch."
          text="Routine samples are processed in-house and land on your record - and your phone - usually before you have left the building. Nothing is couriered to a lab three districts away."
          
        />

        <Stat
          className="sm:col-span-2 p-5 sm:p-6"
          value={1}
          label="Hospital ID, for life"
          title="One ID carries every visit you have ever had here."
          text="Prescriptions, scans and bills, all on one record. Ten years on, a doctor you have never met can read your history in the time it takes to sit down."
        />

        {/* the one filled cell - the only place the accent is spent */}
        <Cell className="flex flex-col p-5 sm:p-6 justify-between bg-[var(--teal)] sm:col-span-2">
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">
            Ready when you are
          </p>
          <div className="mt-8">
            <p className="display-sm max-w-[22ch] text-white">
              Pick your consultant, pick your slot.
            </p>
            <Reveal className="mt-6" y={12}>
              <Link href="/book" className="link-arrow link-arrow-dark">
                Book a consultation
                <span className="link-arrow-dot">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            </Reveal>
          </div>
        </Cell>
      </Stagger>
    </Chapter>
  );
}

/**
 * One bento cell. White, 16px corners, no border and no shadow - the porcelain
 * behind it is what draws the edge.
 */
function Cell({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[16px] bg-[var(--paper)] p-3 sm:p-2 ${className}`}>
      {children}
    </div>
  );
}

/** A number, what it is, and why it matters - in that reading order. */
function Stat({
  value,
  suffix = "",
  label,
  title,
  text,
  className = "",
}: {
  value: number;
  suffix?: string;
  label: string;
  title: string;
  text: string;
  className?: string;
}) {
  return (
    <Cell className={`flex flex-col justify-between ${className}`}>
      <p className=" text-[10px] uppercase tracking-[0.05em] text-[var(--muted)]">
        {label}
      </p>

      <div className="mt-10">
        <p className="stat-num text-[var(--teal)] [font-size:clamp(2rem,3.2vw,2.9rem)]">
          <Counter value={value} suffix={suffix} />
        </p>
        <p className="mt-3 text-[13.5px] font-semibold leading-[1.35] tracking-[-0.015em] text-[var(--ink)]">
          {title}
        </p>
        <p className="mt-2 max-w-[52ch] text-[12.5px] leading-[1.6] text-[var(--ink-soft)]">
          {text}
        </p>
      </div>
    </Cell>
  );
}
