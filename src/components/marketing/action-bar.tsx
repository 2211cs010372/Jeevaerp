import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { HOSPITAL } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Stagger } from "./motion";

/**
 * The four fast lanes, as four small portrait cards.
 *
 * Most people arriving here have already decided what they want before the
 * page finishes loading: a doctor, a slot, a room rate, or a phone call. This
 * row sits directly under the marquee so none of those four needs a scroll.
 *
 * 4:5, LIKE A PORTRAIT POST, AND HELD SMALL. The row is centred in a narrow
 * track (about 1040px on a desktop, 600px on an iPad) rather than run edge to
 * edge, so the four read as one compact set of choices instead of four
 * billboards. On an iPad, two across and two down, the set is a poster.
 *
 * A PHOTOGRAPH SAYS WHICH LANE IT IS BEFORE THE WORDS DO. A stethoscope for
 * the doctors, a waiting area for booking, a room for prices, a treatment
 * room for emergency. All four are licensed stock (Unsplash, 3840px masters,
 * resized by next/image) and none shows a face - an anonymous face on a
 * "Find a doctor" card reads as one of our consultants, and none of them is.
 *
 * Same voice as the hero: Instrument Serif title, Montserrat for the rest,
 * nothing bold, no borders, no shadows. The emergency card is the only red
 * thing, and it carries the number itself.
 */
const lanes = (consultants: number) => [
  {
    href: "/doctors",
    title: "Find a doctor",
    meta: `${consultants}+ consultants`,
    img: "/images/lane-doctor-4k.jpg",
    alt: "A stethoscope resting beside a laptop",
    focus: "object-[60%_50%]",
  },
  {
    href: "/book",
    title: "Book an appointment",
    meta: "Same-day slots",
    img: "/images/lane-book-4k.jpg",
    alt: "A bright waiting area with seating along a corridor",
    focus: "object-[30%_50%]",
  },
  {
    href: "/#facilities",
    title: "Rooms & wards",
    meta: "General to private, plus ICU",
    img: "/images/lane-rooms-4k.jpg",
    alt: "A private hospital room with a bed and an attendant chair",
    focus: "object-[50%_50%]",
  },
];

export async function ActionBar() {
  const consultants = (await listPublicDoctors()).length;
  const emergency = HOSPITAL.emergency.replace(/\s/g, "");

  return (
    <section className="f-sans bg-white px-[1.5rem] py-[clamp(1.5rem,4vw,3rem)]" aria-label="Quick actions">
      <Stagger
        each={0.07}
        y={20}
        className="mx-auto grid max-w-[600px] grid-cols-2 gap-3 lg:max-w-[1040px] lg:grid-cols-4"
      >
        {lanes(consultants).map((l, i) => (
          <Lane key={l.title} index={i + 1} {...l} />
        ))}

        <Lane
          href={`tel:${emergency}`}
          index={4}
          title="Emergency 24×7"
          meta={
            <span className="flex items-center gap-1.5 tabular-nums">
              <span className="pulse pulse-alert" aria-hidden /> {HOSPITAL.emergency}
            </span>
          }
          img="/images/lane-emergency-4k.jpg"
          alt="A clean, equipped treatment room"
          focus="object-[50%_40%]"
          alert
        />
      </Stagger>
    </section>
  );
}

function Lane({
  href,
  index,
  title,
  meta,
  img,
  alt,
  focus,
  alert = false,
}: {
  href: string;
  index: number;
  title: string;
  meta: ReactNode;
  img: string;
  alt: string;
  /** object-position for the 4:5-ish crop of a landscape master */
  focus: string;
  alert?: boolean;
}) {
  const body = (
    <>
      {/* the photograph - most of the card */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[11px] bg-[var(--bone-deep)]">
        <Image
          src={img}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 250px, (min-width: 768px) 290px, 45vw"
          className={`object-cover transition-transform duration-700 ease-[var(--ease-out)] group-hover:scale-[1.04] ${focus}`}
        />
        <span className="absolute left-2.5 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-[var(--ink)] backdrop-blur">
          {String(index).padStart(2, "0")}
        </span>
        <span
          className={`absolute right-2.5 top-2.5 grid h-7 w-7 place-items-center rounded-full bg-white/85 backdrop-blur transition-[transform,background-color,color] duration-400 group-hover:rotate-45 ${
            alert
              ? "text-[var(--alert)] group-hover:bg-[var(--alert)] group-hover:text-white"
              : "text-[var(--ink)] group-hover:bg-[var(--ink)] group-hover:text-white"
          }`}
        >
          <ArrowUpRight size={13} />
        </span>
      </div>

      {/* the words */}
      <div className="px-1.5 pb-1 pt-2.5 sm:px-2 sm:pt-3">
        <p className={`text-[10.5px] font-medium sm:text-[11.5px] ${alert ? "text-[var(--alert)]" : "text-[var(--muted)]"}`}>
          {meta}
        </p>
        <h3
          className={`f-serif mt-0.5 text-[clamp(1.1rem,1.6vw,1.45rem)] leading-[1.05] tracking-[-0.01em] ${
            alert ? "text-[var(--alert)]" : "text-[var(--ink)]"
          }`}
        >
          {title}
        </h3>
      </div>
    </>
  );

  const cls = `group flex aspect-[4/5] flex-col rounded-[16px] p-1.5 transition-colors duration-300 ${
    alert ? "bg-[var(--alert-soft)] hover:bg-[var(--alert)]/15" : "bg-[var(--bone)] hover:bg-[var(--bone-deep)]"
  }`;

  // A phone number is not a route - next/link would try to prefetch it.
  return href.startsWith("tel:") ? (
    <a href={href} className={cls}>{body}</a>
  ) : (
    <Link href={href} className={cls}>{body}</Link>
  );
}
