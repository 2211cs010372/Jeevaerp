import Image from "next/image";
import { WARDS } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Counter, Parallax, Reveal, Stagger } from "./motion";

/**
 * Chapter 06 - what is actually in the building.
 *
 * A bento, but a disciplined one: two media panels carry the weight and four
 * ruled cells carry the detail. Every claim is scoped to something the
 * hospital has already published elsewhere on this site - lab, radiology, day
 * theatre, ICU, 24x7 emergency. Nothing is listed that a family could travel
 * here for and not find.
 */
const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CELLS = [
  {
    index: "01",
    title: "In-house laboratory",
    text: "Routine blood work in about 30 minutes. Reports land on your record and your phone, and stay there for every future visit.",
    icon: (
      <g {...stroke}>
        <path d="M9 3h6M10 3v6.3L4.8 18a2.4 2.4 0 0 0 2.1 3.6h10.2a2.4 2.4 0 0 0 2.1-3.6L14 9.3V3" />
        <path d="M7.5 15h9" />
      </g>
    ),
  },
  {
    index: "02",
    title: "Digital X-ray & imaging",
    text: "On-site X-ray for fractures and spine, with imaging support for neurology. Scans are read with your full history in view.",
    icon: (
      <g {...stroke}>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M12 6v12M8.5 9h7M9.5 12h5M10.5 15h3" />
      </g>
    ),
  },
  {
    index: "03",
    title: "ECG · 2D Echo · TMT",
    text: "Cardiac work-ups the same day. Chest pain and rhythm complaints are assessed without a referral across town.",
    icon: (
      <g {...stroke}>
        <path d="M3 12h4l2-4 3.5 8 2.5-5 1.5 1h4.5" />
      </g>
    ),
  },
  {
    index: "04",
    title: "In-house pharmacy",
    text: "Batch-tracked stock with automatic expiry checks, dispensed against your Jeeva ID with a printed GST bill.",
    icon: (
      <g {...stroke}>
        <rect x="3" y="8" width="18" height="13" rx="2.5" />
        <path d="M8 8V6a4 4 0 0 1 8 0v2M12 11.5v5M9.5 14h5" />
      </g>
    ),
  },
];

export function Facilities() {
  const beds = WARDS.reduce((s, w) => s + w.beds, 0);

  return (
    <Chapter id="facilities" tone="paper">
      <ChapterHead
        index="06"
        label="Facilities"
        lines={[{ text: "Everything under" }, { text: "one roof, on purpose." }]}
        lede="The point of a multispeciality building is that the test, the scan and the medicine are a corridor away, not another trip across town."
      />

      {/* two media panels - the emergency door and the wards */}
      <div className="mt-14 grid gap-4 sm:mt-18 lg:grid-cols-12">
        <Reveal className="lg:col-span-7" y={30}>
          <article className="media-frame relative flex aspect-[16/10] flex-col justify-end p-7 sm:p-9">
            <Parallax amount={9} className="absolute inset-0 h-[110%] -top-[5%]">
              <Image
                src="/images/lab.avif"
                alt="Jeeva diagnostics laboratory"
                fill
                sizes="(max-width: 1024px) 100vw, 58vw"
                className="object-cover"
              />
            </Parallax>
            <div className="relative z-10">
              <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.2em] text-white/65">
                <span className="pulse" /> Diagnostics
              </p>
              <p className="display-lead mt-4 text-white [font-size:clamp(2rem,3.6vw,3.2rem)]">
                <Counter value={30} suffix=" min" />
              </p>
              <p className="mt-2 max-w-md text-[14px] leading-[1.6] text-white/75">
                Average turnaround on routine bloods, processed in this building
                rather than sent out and waited on.
              </p>
            </div>
          </article>
        </Reveal>

        <Reveal className="lg:col-span-5" y={30} delay={0.1}>
          <article className="media-frame relative flex h-full min-h-[320px] flex-col justify-end p-7 sm:p-9">
            <Image
              src="/images/bed.avif"
              alt="Jeeva inpatient ward"
              fill
              sizes="(max-width: 1024px) 100vw, 40vw"
              className="object-cover"
            />
            <div className="relative z-10">
              <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/65">
                Inpatient · ICU
              </p>
              <p className="display-lead mt-4 text-white [font-size:clamp(2rem,3.6vw,3.2rem)]">
                <Counter value={beds} /> beds
              </p>
              <p className="mt-2 text-[14px] leading-[1.6] text-white/75">
                General, semi-private and private rooms plus a monitored ICU,
                with published day rates and a bed for the attendant.
              </p>
            </div>
          </article>
        </Reveal>
      </div>

      {/* the detail, ruled */}
      <Stagger
        each={0.08}
        y={22}
        className="mt-4 grid border-t border-[var(--line-strong)] sm:grid-cols-2 lg:grid-cols-4"
      >
        {CELLS.map((c) => (
          <div
            key={c.title}
            className="border-b border-[var(--line)] px-1 py-8 sm:px-6 lg:border-b-0 lg:border-l lg:first:border-l-0 lg:first:pl-0"
          >
            <div className="flex items-center justify-between gap-4">
              <span className="text-[var(--teal)]">
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                  {c.icon}
                </svg>
              </span>
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                ({c.index})
              </span>
            </div>
            <h3 className="mt-6 text-[15.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {c.title}
            </h3>
            <p className="mt-2.5 text-[13px] leading-[1.7] text-[var(--ink-soft)]">{c.text}</p>
          </div>
        ))}
      </Stagger>
    </Chapter>
  );
}
