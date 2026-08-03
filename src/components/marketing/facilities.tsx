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
 * THE PHOTOGRAPHS ARE OUT FROM UNDER THE DIM. Every cell used to be a picture
 * knocked back to 42% brightness under a pine wash, with white type sitting on
 * top of it. That was the right fix for the wrong shape: type on a photograph
 * needs the photograph darkened, and darkening seven of them in a row left the
 * chapter looking like it had been switched off - a wall of murk where the
 * argument is that this building has real rooms in it.
 *
 * So the type came off the picture. Each cell is now built the way the
 * consultant card is built: a padded cell with the photograph inset in its own
 * frame, and the words underneath on the cell's own surface. The picture gets
 * to be a picture at full brightness, the words get ink on bone instead of
 * white on grey, and both stop competing for the same square inch.
 *
 * Every claim is scoped to something the hospital has already published
 * elsewhere on this site - lab, radiology, day theatre, ICU, 24x7 emergency.
 * Nothing is listed that a family could travel here for and not find.
 *
 * IT STAYS A BENTO ON A PHONE, like "Why Jeeva" and the care model. Two
 * columns from 320px up: the two number panels and the emergency cell run the
 * full width, and the four detail cells pair off two to a row.
 */

/* The consultant card's construction at the bento's radii - 16px outer, a 9px
   frame for the media, bone on the chapter's paper so the step in value is
   what draws the edge. `zoom-media` carries the hover zoom, and unlike the
   inline scale it used to have, it stands down under prefers-reduced-motion. */
const CELL = "flex h-full flex-col rounded-[16px] bg-[var(--bone)] p-2.5 sm:p-3";
const MEDIA =
  "zoom-media relative overflow-hidden rounded-[9px] bg-[var(--bone-deep)]";
const CAPTION = "px-1.5 pt-4 pb-1 sm:px-2";

/* The two number panels let their photograph take the slack (`flex-1`) because
   the diagnostics cell is two rows deep at `lg` and has to fill them. The four
   detail cells must not: a card whose caption runs a line longer than its
   neighbour's would pay for it out of the picture, and a photo 20px shorter
   than the one beside it is the kind of misalignment you see before you can
   name it. They take a fixed frame instead, and the slack falls at the foot of
   the cell where it is just more bone. */
const DETAIL_MEDIA = "sm:h-44";
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
    span: "col-span-2",
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
        className="mt-12 grid grid-cols-2 gap-3 sm:mt-16 lg:grid-cols-4"
      >
        {/* diagnostics - the widest and deepest cell, and the only one that
            moves against the scroll */}
        <article className={`${CELL} col-span-2 lg:row-span-2`}>
          <div className={`${MEDIA} flex-1 max-sm:aspect-[16/10] sm:min-h-[17rem]`}>
            <Parallax amount={9} className="absolute inset-0 h-[110%] -top-[5%]">
              <Image
                src="/images/lab.avif"
                alt="Jeeva diagnostics laboratory"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
            </Parallax>
          </div>

          <div className={CAPTION}>
            <p className="mono flex items-center gap-2.5 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
              <span className="pulse" /> Diagnostics
            </p>
            <p className="display-lead mt-3 text-[var(--teal)] [font-size:clamp(2rem,3.6vw,3.2rem)]">
              <Counter value={30} suffix=" min" />
            </p>
            <p className="mt-2 max-w-md text-[14px] leading-[1.6] text-[var(--ink-soft)]">
              Average turnaround on routine bloods, processed in this building
              rather than sent out and waited on.
            </p>
          </div>
        </article>

        {/* the wards */}
        <article className={`${CELL} col-span-2`}>
          <div className={`${MEDIA} flex-1 max-sm:aspect-[16/10] sm:min-h-[13rem]`}>
            <Image
              src="/images/bed.avif"
              alt="Jeeva inpatient ward"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>

          <div className={CAPTION}>
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
              Inpatient · ICU
            </p>
            <p className="display-lead mt-3 text-[var(--teal)] [font-size:clamp(2rem,3.6vw,3.2rem)]">
              <Counter value={beds} /> beds
            </p>
            <p className="mt-2 text-[14px] leading-[1.6] text-[var(--ink-soft)]">
              General, semi-private and private rooms plus a monitored ICU, with
              published day rates and a bed for the attendant.
            </p>
          </div>
        </article>

        {/* the detail, each on the room it describes */}
        {CELLS.map((c) => {
          /* the emergency cell runs both columns on a phone and keeps its
             sentence; the four narrow ones cannot hold 13px prose in a 140px
             column, so there the photograph and the title carry it */
          const wide = c.span.includes("col-span-2");

          return (
            <article key={c.title} className={`${CELL} ${c.span}`}>
              <div
                className={`${MEDIA} ${DETAIL_MEDIA} ${
                  wide ? "max-sm:aspect-[16/10]" : "max-sm:aspect-[4/3]"
                }`}
              >
                <Image
                  src={c.img}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 25vw"
                  className="object-cover"
                />

                {/* the consultant card's badge, in the same corner it uses */}
                <span className="mono absolute left-3 top-3 z-10 rounded-full bg-black/40 px-2.5 py-1 text-[9.5px] uppercase tracking-[0.14em] text-white backdrop-blur">
                  ({c.index})
                </span>
              </div>

              <div className={CAPTION}>
                <h3 className="flex items-start gap-2.5 text-[15.5px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                  <span aria-hidden className="mt-px shrink-0 text-[var(--teal)]">
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      {c.icon}
                    </svg>
                  </span>
                  {c.title}
                </h3>
                <p
                  className={`mt-2 max-w-[46ch] text-[13px] leading-[1.65] text-[var(--ink-soft)] ${
                    wide ? "" : "max-sm:hidden"
                  }`}
                >
                  {c.text}
                </p>
              </div>
            </article>
          );
        })}
      </Stagger>
    </Chapter>
  );
}
