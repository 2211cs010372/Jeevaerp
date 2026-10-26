import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@/components/ui/hugeicons";
import { DoctorAvatar } from "@/components/marketing/doctor-avatar";
import { DEPARTMENTS } from "@/lib/data";
import { listPublicDoctors } from "@/server/services/public-doctors.service";
import { Counter, Reveal, Stagger } from "./motion";
import { PosterIntro } from "./poster-intro";

/**
 * Chapter 01 - Why Jeeva, in the hero's voice.
 *
 * The same composition the hero opens with, carried down the page so the two
 * read as one piece: plain white, 1.5rem edges, small Montserrat type in
 * narrow columns across the top (a label, a three-line aside, a short
 * paragraph with one ghost button), then the one large Instrument Serif line.
 * Under it, a single 4:5 photograph beside four numbers on hairline rules.
 *
 * THE NUMBERS ARE ALL THINGS THE ERP CAN PROVE: how many departments are
 * staffed, how many consultants sit in them, how fast the lab turns routine
 * bloods around, and the one hospital ID that ties the lot together. They are
 * set as serif numerals over a one-line claim and a short sentence - no tiles,
 * no fills. The hairline above each is the only structure.
 *
 * THE PHOTOGRAPH IS ATMOSPHERE, NOT EVIDENCE. It is a licensed stock image
 * (Unsplash, 3840px) of a light-filled corridor, chosen for the mood the
 * chapter describes - so nothing captions it as this hospital's interior.
 * The only photograph that claims to be Jeeva is the building in the hero.
 *
 * HELD SMALL. The headline is a size under the hero's, and from the iPad up
 * the photograph sits BESIDE the numbers rather than above them - a full-width
 * 4:5 photo on a portrait iPad was 965px tall on its own, a screen and a half
 * before the first number.
 *
 *   phone    one column: photo, then the numbers two-up (claims only)
 *   iPad     photo left (5/12), numbers right (2 x 2, claims only)
 *   desktop  photo left (4/12), numbers right (2 x 2 with their sentences)
 */
export async function Trust() {
  const panel = await listPublicDoctors();
  const faces = panel.slice(0, 4);
  const rest = Math.max(0, panel.length - faces.length);

  const stats = [
    {
      value: DEPARTMENTS.length,
      suffix: "",
      label: "Departments, staffed",
      title: "Most referrals never leave the building.",
      text: "Medicine, surgery, women's and children's health and more, consulting under one roof.",
    },
    {
      value: panel.length,
      suffix: "+",
      label: "Consultants on the panel",
      title: "You know who you are seeing before you book.",
      text: "Named doctors with their days and OPD hours on the record. No pooled queue.",
    },
    {
      value: 30,
      suffix: " min",
      label: "Routine report turnaround",
      title: "Morning bloods are read before lunch.",
      text: "Processed in-house and on your record - and your phone - usually before you leave.",
    },
    {
      value: 1,
      suffix: "",
      label: "Hospital ID, for life",
      title: "One ID carries every visit you have had here.",
      text: "Prescriptions, scans and bills on one record a new doctor can read in the time it takes to sit down.",
    },
  ];

  return (
    /* -mt-px: the quick-actions row above ends on a fractional pixel, and the
       porcelain .site ground showed through the seam as a grey hairline
       between two white sections. */
    <section id="why" className="f-sans relative -mt-px scroll-mt-[var(--nav-h)] bg-white px-[1.5rem] py-[clamp(3.5rem,7vw,6rem)]">
      <PosterIntro
        index="01"
        label="Why Jeeva"
        aside={["One building.", "One record.", "One ID for life."]}
        lede="A hospital that already knows your history stops asking you to be your own medical record. Everything below is what it takes to keep that promise."
        action={{ href: "/doctors", label: "Meet the consultants" }}
        lines={[{ text: "Care that" }, { text: "remembers you.", className: "italic text-[var(--teal)]" }]}
      />

      {/* ── photograph + numbers ─────────────────────────────────────── */}
      <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-x-12 gap-y-8 gap-[5rem] md:grid-cols-12">
        <Reveal y={24} className="md:col-span-5  lg:col-span-4">
          <figure>
            <div className="relative aspect-[4/5] overflow-hidden rounded-[6px] bg-[var(--bone)]">
              <Image
                src="/images/why-corridor-4k.jpg"
                alt="A quiet, light-filled hospital corridor with seating by the windows"
                fill
                sizes="(min-width: 1024px) 32vw, (min-width: 768px) 40vw, 100vw"
                quality={85}
                className="object-cover object-[72%_50%]"
              />
            </div>

            {/* who is actually on the panel */}
            <figcaption className="mt-4 flex items-center justify-between gap-4">
              <span className="text-[12px] font-medium text-[var(--muted)]">Your consultants</span>
              <span className="flex -space-x-2">
                {faces.map((d) => (
                  <DoctorAvatar
                    key={d.id}
                    name={d.name}
                    className="h-8 w-8 rounded-full border-2 border-white text-[9px]"
                  />
                ))}
                {rest > 0 && (
                  <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[var(--bone)] text-[10px] font-medium text-[var(--ink)]">
                    +{rest}
                  </span>
                )}
              </span>
            </figcaption>
          </figure>
        </Reveal>

        <div className="flex flex-col justify-between gap-8 md:col-span-6 md:col-start-7 lg:col-span-6 lg:col-start-7 ">
          <Stagger each={0.08} y={18} className="grid grid-cols-2 gap-x-6 gap-y-8">
            {stats.map((s, i) => (
              <div key={s.label} className="border-t border-[var(--line-strong)] pt-4">
                <div className="flex items-start justify-between gap-3 text-[12px] font-medium text-[var(--muted)]">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <p className="f-serif mt-5 text-[clamp(2.4rem,3.8vw,3.8rem)] leading-[0.9] tracking-[-0.02em] text-[var(--ink)] lg:mt-8">
                  <Counter value={s.value} suffix={s.suffix} />
                </p>
                <p className="mt-3 max-w-[30ch] text-[13.5px] font-medium leading-[1.15] text-[var(--ink)]">
                  {s.title}
                </p>
                <p className="mt-1.5 max-w-[40ch] text-[12.5px] leading-[1.3] text-[var(--ink-soft)] max-lg:hidden">
                  {s.text}
                </p>
              </div>
            ))}
          </Stagger>

          {/* the booking line - where the chapter hands over to an action */}
          <Reveal y={12} className="flex flex-col gap-4 border-t border-[var(--line-strong)] pt-5 sm:flex-row sm:items-end sm:justify-between">
            <p className="f-serif text-[clamp(1.5rem,2.2vw,2rem)] leading-[1] tracking-[-0.015em] text-[var(--ink)]">
              Pick your consultant, <span className="italic text-[var(--muted)]">pick your slot.</span>
            </p>
            <Link href="/book" className="btn-ghost-sm shrink-0 self-start sm:self-auto">
              Book a consultation <ArrowUpRight size={14} />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
