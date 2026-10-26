import { JOURNEY } from "@/lib/data";
import { Stagger } from "./motion";
import { PosterIntro, POSTER_SECTION } from "./poster-intro";

/**
 * Chapter 04 - a first visit, in four cards.
 *
 * The four desks somebody passes through the first time they come - register,
 * consult, diagnostics, pharmacy - each as a portrait card: the step's number
 * large in the serif, what to expect beside it, then the step and the one
 * thing it spares you. From the iPad up each card is 4:5; on a phone they
 * stack, because four 160px columns of prose is not a layout.
 *
 * Absorbs the old care-model chapter: its six pillars were this journey said
 * a second time in the abstract, beside a "Why Jeeva" that already says it.
 */
export function FirstVisit() {
  return (
    <section id="first-visit" className={POSTER_SECTION}>
      <PosterIntro
        index="04"
        label="Your first visit"
        aside={["Four desks.", "About an hour.", "Once, ever."]}
        lede="What happens the first time you come in, desk by desk - and what each step means you never have to do again."
        action={{ href: "/book", label: "Book a first visit" }}
        lines={[{ text: "From the door" }, { text: "to the pharmacy.", className: "italic text-[var(--teal)]" }]}
      />

      <Stagger
        each={0.07}
        y={20}
        className="mx-auto mt-[clamp(2rem,4vw,3rem)] grid max-w-[600px] gap-2 sm:grid-cols-2 lg:max-w-[1180px] lg:grid-cols-4"
      >
        {JOURNEY.map((s, i) => (
          <article
            key={s.step}
            className={`flex flex-col justify-between gap-8 rounded-[12px] p-4 sm:aspect-[4/5] sm:p-5 ${
              i === JOURNEY.length - 1 ? "bg-[var(--teal-soft)]" : "bg-[var(--bone)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="f-serif text-[clamp(3rem,5vw,4.2rem)] leading-[0.8] tracking-[-0.02em] text-[var(--teal)]">
                {s.step}
              </span>
              <span className="mt-1 max-w-[16ch] text-right text-[11px] font-medium leading-[1.25] text-[var(--muted)]">
                {s.meta}
              </span>
            </div>

            <div>
              <h3 className="f-serif text-[clamp(1.6rem,2.4vw,2.1rem)] leading-[1] tracking-[-0.01em] text-[var(--ink)]">
                {s.title}
              </h3>
              <p className="mt-2 text-[12.5px] font-medium leading-[1.3] text-[var(--ink-soft)]">{s.text}</p>
              <p className="f-serif mt-3 border-t border-[var(--line-strong)] pt-2.5 text-[15px] italic leading-[1.15] text-[var(--muted)]">
                {s.why}
              </p>
            </div>
          </article>
        ))}
      </Stagger>
    </section>
  );
}
