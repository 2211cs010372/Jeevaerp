import Image from "next/image";
import { WARDS } from "@/lib/data";
import { Chapter, ChapterHead } from "./section";
import { Counter, Parallax, Stagger } from "./motion";

/**
 * Chapter 06 - what is actually in the building.
 *
 * A bento in chapter 01's grammar: cells of different weights, 16px corners,
 * 12px gutters, no borders and no shadows. Two media panels carry the numbers
 * and five image cells carry the detail.
 *
 * WHY EVERY CELL IS A PHOTOGRAPH NOW. The detail used to be four line icons on
 * white. An icon of a microscope tells a family nothing about whether this
 * hospital has a lab; the room does. Each photograph is dimmed hard - down to
 * 42% - and laid under a pine wash, because these are backgrounds carrying
 * white type, not pictures being shown for their own sake. At full brightness
 * the type stops being readable and the grid turns into a contact sheet.
 *
 * Every claim is scoped to something the hospital has already published
 * elsewhere on this site - lab, radiology, day theatre, ICU, 24x7 emergency.
 * Nothing is listed that a family could travel here for and not find.
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
    title: "Digital X-ray & imaging",
    text: "On-site X-ray for fractures and spine, with imaging support for neurology.",
    img: "/images/dept-orthopaedics.avif",
    span: "",
    icon: (
      <g {...stroke}>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M12 6v12M8.5 9h7M9.5 12h5M10.5 15h3" />
      </g>
    ),
  },
  {
    index: "02",
    title: "ECG · 2D Echo · TMT",
    text: "Cardiac work-ups the same day. Chest pain assessed without a referral across town.",
    img: "/images/dept-cardiology.avif",
    span: "",
    icon: (
      <g {...stroke}>
        <path d="M3 12h4l2-4 3.5 8 2.5-5 1.5 1h4.5" />
      </g>
    ),
  },
  {
    index: "03",
    title: "In-house pharmacy",
    text: "Batch-tracked stock, dispensed against your Jeeva ID with a printed GST bill.",
    img: "/images/hospital_banner.jpeg",
    span: "",
    icon: (
      <g {...stroke}>
        <rect x="3" y="8" width="18" height="13" rx="2.5" />
        <path d="M8 8V6a4 4 0 0 1 8 0v2M12 11.5v5M9.5 14h5" />
      </g>
    ),
  },
  {
    index: "04",
    title: "Day theatre",
    text: "Minor procedures and day surgery, with recovery in the same building.",
    img: "/images/dept-general-medicine.avif",
    span: "",
    icon: (
      <g {...stroke}>
        <circle cx="12" cy="7" r="3.2" />
        <path d="M12 10.2V21M7 21h10M4.5 7H6M18 7h1.5" />
      </g>
    ),
  },
  {
    index: "05",
    title: "Emergency, always open",
    text: "The doors do not close. Triage, resuscitation and admission run through the night and through every holiday.",
    img: "/images/jeeva-header.jpeg",
    span: "sm:col-span-2",
    icon: (
      <g {...stroke}>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M12 8v8M8 12h8" />
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

      <Stagger
        each={0.07}
        y={22}
        className="mt-12 grid gap-3 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4"
      >
        {/* diagnostics - the widest and deepest cell, and the only one that
            moves against the scroll */}
        <article className="group relative flex min-h-[19rem] flex-col justify-end overflow-hidden rounded-[16px] sm:col-span-2 lg:row-span-2">
          <Parallax amount={9} className="absolute inset-0 h-[110%] -top-[5%]">
            <Image
              src="/images/lab.avif"
              alt="Jeeva diagnostics laboratory"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover brightness-[0.42]"
            />
          </Parallax>
          <Wash />

          <div className="relative z-10 p-6 sm:p-8">
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

        {/* the wards */}
        <article className="group relative flex min-h-[15rem] flex-col justify-end overflow-hidden rounded-[16px] sm:col-span-2">
          <Image
            src="/images/bed.avif"
            alt="Jeeva inpatient ward"
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover brightness-[0.42] transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.05]"
          />
          <Wash />

          <div className="relative z-10 p-6 sm:p-8">
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/65">
              Inpatient · ICU
            </p>
            <p className="display-lead mt-4 text-white [font-size:clamp(2rem,3.6vw,3.2rem)]">
              <Counter value={beds} /> beds
            </p>
            <p className="mt-2 text-[14px] leading-[1.6] text-white/75">
              General, semi-private and private rooms plus a monitored ICU, with
              published day rates and a bed for the attendant.
            </p>
          </div>
        </article>

        {/* the detail, each on the room it describes */}
        {CELLS.map((c) => (
          <article
            key={c.title}
            className={`group relative flex min-h-[13.5rem] flex-col justify-end overflow-hidden rounded-[16px] ${c.span}`}
          >
            <Image
              src={c.img}
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover brightness-[0.42] transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.05]"
            />
            <Wash />

            <div className="absolute inset-x-5 top-5 z-10 flex items-center justify-between gap-4 sm:inset-x-6 sm:top-6">
              <span className="text-white">
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                  {c.icon}
                </svg>
              </span>
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-white/55">
                ({c.index})
              </span>
            </div>

            <div className="relative z-10 p-5 sm:p-6">
              <h3 className="text-[15.5px] font-semibold tracking-[-0.02em] text-white">
                {c.title}
              </h3>
              <p className="mt-2 max-w-[46ch] text-[13px] leading-[1.65] text-white/72">
                {c.text}
              </p>
            </div>
          </article>
        ))}
      </Stagger>
    </Chapter>
  );
}

/**
 * The scrim every cell shares. The brightness filter alone flattens the photo
 * evenly, which leaves white type fighting whatever happens to be bright at the
 * foot of the frame - the wash puts the contrast where the words are.
 */
function Wash() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 bg-gradient-to-t from-[var(--pine-ink)]/88 via-[var(--pine-ink)]/38 to-[var(--pine-ink)]/15"
    />
  );
}
