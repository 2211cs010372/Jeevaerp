import { Chapter, ChapterHead } from "./section";
import { Stagger } from "./motion";

/**
 * Chapter 08 - what people say on the way out.
 *
 * Deliberately small and specific. Every quote names one concrete thing that
 * happened - a report arriving before lunch, a bill matching a quote - because
 * "excellent service, highly recommended" is what a review farm writes and
 * everybody knows it.
 *
 * The first note is set at display size and given the width of two: a wall of
 * identical cards reads as a testimonial widget, and one quote pulled up to
 * lead reads as an edited page.
 */
const STORIES: { quote: string; name: string; role: string }[] = [
  {
    quote:
      "The doctor already had my last visit open when I walked in. I didn't have to explain anything twice.",
    name: "Ramesh K.",
    role: "OPD patient",
  },
  {
    quote:
      "Blood test at 9, report on my phone before lunch. My father's diabetes review was done in one morning.",
    name: "Priya M.",
    role: "Attendant",
  },
  {
    quote:
      "They told me the ward rate before admission, and the discharge bill matched it to the rupee.",
    name: "Suresh V.",
    role: "IPD attendant",
  },
  {
    quote:
      "The pharmacist noticed the prescription was a day short and checked with the doctor before billing me.",
    name: "Lakshmi D.",
    role: "Pharmacy patient",
  },
  {
    quote: "Booked online for my mother at 8 in the morning - she was seen by 8:40.",
    name: "Anita R.",
    role: "Attendant",
  },
];

export function Testimonials() {
  const [lead, ...rest] = STORIES;

  return (
    <Chapter id="stories" tone="light">
      <ChapterHead
        index="08"
        label="In their words"
        lines={[{ text: "What people tell us" }, { text: "on their way out." }]}
        lede="Kept short, and kept exactly as they said it at the desk."
      />

      <Stagger
        each={0.09}
        y={26}
        className="mt-14 grid gap-4 sm:mt-18 sm:grid-cols-2 lg:grid-cols-3"
      >
        <figure className="card flex flex-col justify-between gap-8 p-8 sm:col-span-2 sm:p-10">
          <blockquote className="display-sm max-w-2xl text-[var(--ink)]">
            &ldquo;{lead.quote}&rdquo;
          </blockquote>
          <Attribution name={lead.name} role={lead.role} />
        </figure>

        {rest.map((s) => (
          <figure key={s.name} className="card card-hover flex flex-col justify-between gap-7 p-7">
            <blockquote className="text-[14.5px] leading-[1.65] text-[var(--ink-soft)]">
              &ldquo;{s.quote}&rdquo;
            </blockquote>
            <Attribution name={s.name} role={s.role} />
          </figure>
        ))}
      </Stagger>
    </Chapter>
  );
}

function Attribution({ name, role }: { name: string; role: string }) {
  return (
    <figcaption className="flex items-center gap-3 border-t border-[var(--line)] pt-5">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--teal-soft)] text-[11px] font-bold text-[var(--teal-deep)]">
        {name[0]}
      </span>
      <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
        <span className="font-semibold text-[var(--ink)]">{name}</span> · {role}
      </span>
    </figcaption>
  );
}
