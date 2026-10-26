import { HOSPITAL } from "@/lib/data";
import { Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 06 - patient stories, as portrait posters.
 *
 * Each story is a 4:5 card built to be posted as it stands: a story number, a
 * short quote set large in Instrument Serif, the person and who they were
 * here as, and the hospital's name at the foot like a signature. The five
 * cards take turns through the page's own tints - bone, sage, sand, white and
 * one pine card - so a run of them on an Instagram grid reads as a series
 * rather than five copies of one template.
 *
 * Every quote names one concrete thing that happened - a report before lunch,
 * a bill that matched what the desk said - because "excellent service, highly
 * recommended" is what a review farm writes. No portraits: these are real
 * patients, and inventing a face for one would be the most dishonest thing on
 * the site. No prices either, in a quote or anywhere else.
 *
 *   phone / iPad   a swipe rail, one and a bit cards in view on a phone; on an
 *                  iPad each card is 296px wide, the first-visit card's size
 *   desktop        all five in a row
 */
const STORIES: { quote: string; name: string; role: string }[] = [
  {
    quote: "The doctor already had my last visit open when I walked in. I didn't have to explain anything twice.",
    name: "Ramesh K.",
    role: "OPD patient",
  },
  {
    quote: "Blood test at 9, report on my phone before lunch. My father's diabetes review was done in one morning.",
    name: "Priya M.",
    role: "Attendant",
  },
  {
    quote: "They told me the ward rate before admission, and the discharge bill matched it to the rupee.",
    name: "Suresh V.",
    role: "IPD attendant",
  },
  {
    quote: "The pharmacist noticed the prescription was a day short and checked with the doctor before billing me.",
    name: "Lakshmi D.",
    role: "Pharmacy patient",
  },
  {
    quote: "Booked online for my mother at 8 in the morning - she was seen by 8:40.",
    name: "Anita R.",
    role: "Attendant",
  },
];

/** ground, ink, soft ink - one per card, in order */
const TONES = [
  ["bg-[var(--bone)]", "text-[var(--ink)]", "text-[var(--muted)]"],
  ["bg-[var(--sky-soft)]", "text-[var(--ink)]", "text-[var(--muted)]"],
  ["bg-[var(--pine-ink)]", "text-white", "text-white/55"],
  ["bg-[var(--peach-soft)]", "text-[var(--ink)]", "text-[var(--muted)]"],
  ["bg-[var(--teal-soft)]", "text-[var(--ink)]", "text-[var(--muted)]"],
] as const;

export function Stories() {
  return (
    <section id="stories" className={POSTER_SECTION}>
      <PosterIntro
        index="06"
        label="Patient stories"
        aside={["In their words.", "One thing each."]}
        lede="Small, specific things people told us on the way out - the kind of detail that is the difference between a hospital and a good one."
        lines={[{ text: "What people say" }, { text: "on the way out.", className: "italic text-[var(--teal)]" }]}
      />

      {/* A plain overflow rail below lg: native horizontal scroll with snap,
          no JavaScript, so a thumb always lands on a whole card. It runs to
          the screen edge and pads back in, so the first card lines up with
          the 1.5rem edge and the last one is not cut off. */}
      <Stagger
        each={0.06}
        y={20}
        className="-mx-[1.5rem] mt-[clamp(2rem,4vw,3rem)] flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-[1.5rem] px-[1.5rem] pb-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {STORIES.map((s, i) => {
          const [ground, ink, soft] = TONES[i % TONES.length];
          return (
            <figure
              key={s.name}
              className={`flex aspect-[4/5] w-[78%] shrink-0 snap-start flex-col justify-between rounded-[12px] p-5 sm:w-[296px] lg:w-auto ${ground}`}
            >
              <div className={`flex items-center justify-between text-[11px] font-medium ${soft}`}>
                <span>Story {String(i + 1).padStart(2, "0")}</span>
                <span className="f-serif text-[22px] leading-none" aria-hidden>
                  &ldquo;
                </span>
              </div>

              <blockquote className={`f-serif text-[clamp(1.25rem,1.7vw,1.5rem)] leading-[1.12] tracking-[-0.01em] ${ink}`}>
                {s.quote}
              </blockquote>

              <figcaption className={`flex items-end justify-between gap-3 text-[11.5px] font-medium ${soft}`}>
                <span>
                  <span className={`block text-[13px] ${ink}`}>{s.name}</span>
                  {s.role}
                </span>
                <span className="text-right">{HOSPITAL.shortName}</span>
              </figcaption>
            </figure>
          );
        })}
      </Stagger>
    </section>
  );
}
